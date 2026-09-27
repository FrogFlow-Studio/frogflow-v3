import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import type { Tenant } from "@/core/tenant/types";
import { runWithZernioEvent } from "./event-context.server";
import type { ZernioWebhookMessagePayload } from "./message";

/**
 * Обработка одного события Zernio по типу — общая для вебхука и добора
 * зависших. Итог пишется в строку журнала: processed / failed с причиной.
 */
export const HANDLED_EVENTS = [
  "message.received",
  "comment.received",
  "account.disconnected",
  "whatsapp.template.status_updated",
  "message.failed",
] as const;

export function isHandledEvent(event: string | undefined): boolean {
  return (HANDLED_EVENTS as readonly string[]).includes(event ?? "");
}

export type DispatchOutcome = { status: "processed" | "ignored" | "failed"; note: string | null };

export async function dispatchZernioEvent(
  ctx: TenantContext,
  eventId: string,
  payload: ZernioWebhookMessagePayload,
): Promise<DispatchOutcome> {
  try {
    if (payload.event === "comment.received") {
      // Двухшаговая Comment-to-DM: второе сообщение с кнопками после первого от Zernio.
      const { handleCommentReceived } = await import("./automations.server");
      const r = ctx.tenant.modules.instagram
        ? await runWithZernioEvent(eventId, () =>
            handleCommentReceived(
              ctx,
              payload as import("./automations.server").CommentReceivedPayload,
            ),
          )
        : { note: "модуль «instagram» у клиента выключен" };
      return { status: "processed", note: r.note };
    }
    if (payload.event === "whatsapp.template.status_updated") {
      const { handleTemplateStatus } = await import("./templates.server");
      const r = await handleTemplateStatus(
        ctx,
        payload as import("./templates.server").TemplateStatusPayload,
      );
      return { status: "processed", note: r.note };
    }
    if (payload.event === "message.failed") {
      const { handleMessageFailed } = await import("./message-failed.server");
      const r = await handleMessageFailed(
        ctx,
        payload as import("./message-failed.server").MessageFailedPayload,
      );
      return { status: "processed", note: r.note };
    }
    if (payload.event === "account.disconnected") {
      const { handleAccountDisconnected } = await import("./handle-account");
      const r = await handleAccountDisconnected(ctx, payload);
      return { status: "processed", note: r.note };
    }
    const { handleZernioMessage } = await import("./handle-message");
    const r = await runWithZernioEvent(eventId, () => handleZernioMessage(ctx, payload));
    return { status: r.status, note: r.note ?? null };
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    const { reportError } = await import("@/lib/errors");
    await reportError(e, {
      where: "zernio.dispatch",
      botId: ctx.tenant.id,
      extra: { event_id: eventId },
    });
    return { status: "failed", note };
  }
}

/** Итог обработки — в строку журнала (вставлена до обработки со статусом received). */
export async function settleZernioEvent(ctx: TenantContext, eventId: string, r: DispatchOutcome) {
  await ctx.db
    .from("zernio_logs")
    .update({ status: r.status, error_message: r.note })
    .eq("event_id", eventId);
}

export const STUCK_AFTER_MS = 3 * 60_000;
/** Окно ответа Instagram/WhatsApp — 24 часа: ответ на более старое событие не уйдёт. */
export const STALE_AFTER_MS = 24 * 60 * 60_000;
/** Добор, который начал прогон и не закончил (функция умерла), — через столько считаем брошенным. */
export const ABANDONED_AFTER_MS = 10 * 60_000;
const CLAIM_NOTE = "добор начат ";
/** Метка захвата фоном вебхука (intake.server) — первая попытка обработки. */
const FIRST_CLAIM_NOTE = "обработка начата ";
/** Фон вебхука начал отправлять наружу (lib/external-effects) — повторять нельзя. */
const SENDING_NOTE = "отправка начата ";

export type RetryResult = {
  found: number;
  processed: number;
  failed: number;
  ignored: number;
  /** Старше суток — закрыто без обработки. */
  expired: number;
  /** Прогон добора оборвался на полпути — закрыто без повтора. */
  abandoned: number;
  /** Фон вебхука оборвался — событие возвращено в очередь добора. */
  requeued: number;
};

/** Когда строку забрали в обработку (метка в error_message), или null. */
export function claimedAt(note: string | null): number | null {
  const prefix = [CLAIM_NOTE, FIRST_CLAIM_NOTE, SENDING_NOTE].find((p) => note?.startsWith(p));
  if (!prefix) return null;
  const t = Date.parse(note!.slice(prefix.length));
  return Number.isNaN(t) ? null : t;
}

/** Строку забрал фон вебхука (первая попытка) и ещё ничего не отправил. */
export const claimedByWebhook = (note: string | null) =>
  Boolean(note?.startsWith(FIRST_CLAIM_NOTE));

/**
 * Перед первой отправкой фона вебхука (покупателю, продавцу, почтой):
 * после этой отметки брошенное событие добор не повторяет — ответ
 * консультанта или уведомление продавцу ушли бы второй раз.
 */
export async function markZernioEventSending(
  ctx: TenantContext,
  eventId: string,
  now = new Date(),
): Promise<void> {
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ error_message: `${SENDING_NOTE}${now.toISOString()}` })
    .eq("event_id", eventId)
    .eq("status", "retrying");
  if (error) throw new Error(`zernio_logs: ${error.message}`);
}

/**
 * Забрать строку журнала в обработку: received → retrying с меткой времени.
 * Условная запись по старому статусу — из фона вебхука и из добора событие
 * обрабатывает ровно один. Строку, забранную и не закрытую (функция умерла),
 * добор через ABANDONED_AFTER_MS возвращает в очередь, если это был фон
 * вебхука, и закрывает как сбой, если это был уже повтор.
 */
export async function claimZernioEvent(
  ctx: TenantContext,
  eventId: string,
  now = new Date(),
  by: "webhook" | "retry" = "retry",
): Promise<boolean> {
  const note = `${by === "webhook" ? FIRST_CLAIM_NOTE : CLAIM_NOTE}${now.toISOString()}`;
  const { data } = await ctx.db
    .from("zernio_logs")
    .update({ status: "retrying", error_message: note })
    .eq("event_id", eventId)
    .eq("status", "received")
    .select("event_id");
  return Boolean(data?.length);
}

/**
 * Добор зависших событий. Вебхук пишет строку `received` до обработки;
 * если функция умерла по таймауту или изолят погасили после ответа, строка
 * остаётся `received` навсегда, а покупатель — без ответа (v1: 69
 * потерянных событий Instagram). Крон берёт такие строки старше трёх
 * минут и прогоняет тем же обработчиком: идемпотентность отправок —
 * по event_id (Idempotency-Key), так что повтор не удваивает ответ.
 *
 * Два края: событие старше суток закрывается без ответа (окно переписки
 * закрыто, отвечать на вчерашнее поздно), а строка, которую прошлый добор
 * забрал и не закрыл, закрывается как сбой — второй повтор мог бы дважды
 * позвать консультанта и дважды написать продавцу. Строка, которую забрал и
 * не закрыл фон вебхука, — первая попытка: её добор повторяет, только если
 * фон ещё ничего не отправил (нет отметки markZernioEventSending).
 */
export async function retryStuckEvents(
  ctx: TenantContext,
  now = new Date(),
  dispatch: typeof dispatchZernioEvent = dispatchZernioEvent,
  limit = 20,
): Promise<RetryResult> {
  const res: RetryResult = {
    found: 0,
    processed: 0,
    failed: 0,
    ignored: 0,
    expired: 0,
    abandoned: 0,
    requeued: 0,
  };
  const t = now.getTime();

  const { data: hung } = await ctx.db
    .from("zernio_logs")
    .select("event_id, error_message")
    .eq("status", "retrying")
    .limit(50);
  for (const row of hung ?? []) {
    const at = claimedAt(row.error_message);
    if (!row.event_id || (at !== null && t - at < ABANDONED_AFTER_MS)) continue;
    if (claimedByWebhook(row.error_message)) {
      // Условно по той же метке: второй крон, успевший раньше, уже вернул строку.
      const { data: back } = await ctx.db
        .from("zernio_logs")
        .update({ status: "received", error_message: "фон вебхука прерван, повтор добором" })
        .eq("event_id", row.event_id)
        .eq("status", "retrying")
        .eq("error_message", row.error_message!)
        .select("event_id");
      if (back?.length) res.requeued++;
      continue;
    }
    const { data: closed } = await ctx.db
      .from("zernio_logs")
      .update({
        status: "failed",
        error_message: row.error_message?.startsWith(SENDING_NOTE)
          ? "фон вебхука прерван после начала отправки — не повторяем, чтобы не написать дважды"
          : "добор прерван: функция не завершилась",
      })
      .eq("event_id", row.event_id)
      .eq("status", "retrying")
      .select("event_id");
    if (closed?.length) res.abandoned++;
  }

  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("event_id, event_type, payload, created_at")
    .eq("status", "received")
    .in("event_type", [...HANDLED_EVENTS])
    .lt("created_at", new Date(t - STUCK_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`zernio_logs: ${error.message}`);
  for (const row of data ?? []) {
    if (!row.event_id) continue;
    res.found++;
    if (t - Date.parse(row.created_at) > STALE_AFTER_MS) {
      const { data: closed } = await ctx.db
        .from("zernio_logs")
        .update({ status: "failed", error_message: "добор: старше суток, окно ответа закрыто" })
        .eq("event_id", row.event_id)
        .eq("status", "received")
        .select("event_id");
      if (closed?.length) res.expired++;
      continue;
    }
    // Забираем строку: второй запуск крона (и фон вебхука) её не возьмёт.
    if (!(await claimZernioEvent(ctx, row.event_id, now))) continue;
    const r = await dispatch(ctx, row.event_id, payloadOf(row.payload));
    await settleZernioEvent(ctx, row.event_id, {
      ...r,
      note: r.note ? `добор: ${r.note}` : "добор",
    });
    res[r.status]++;
  }
  return res;
}

function payloadOf(json: Json): ZernioWebhookMessagePayload {
  return (json && typeof json === "object" && !Array.isArray(json) ? json : {}) as never;
}

export async function retryStuckEventsFor(
  tenants: readonly Tenant[],
  tenantContext: (t: Tenant) => TenantContext,
): Promise<Record<string, RetryResult | { error: string }>> {
  const out: Record<string, RetryResult | { error: string }> = {};
  for (const t of tenants) {
    if (!t.settings.zernio?.profile_id && !t.settings.zernio?.account_ids?.length) continue;
    // Каналы Zernio выключены — добор не трогает журнал клиента вовсе, как в v1.
    if (!t.modules.instagram && !t.modules.whatsapp) continue;
    try {
      const r = await retryStuckEvents(tenantContext(t));
      if (r.found || r.abandoned || r.requeued) out[t.id] = r;
    } catch (e) {
      out[t.id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}
