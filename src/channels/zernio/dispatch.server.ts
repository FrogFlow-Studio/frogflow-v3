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
    console.error(`[zernio] ${eventId} failed: ${note}`);
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

export type RetryResult = { found: number; processed: number; failed: number; ignored: number };

/**
 * Добор зависших событий. Вебхук пишет строку `received` до обработки;
 * если функция умерла по таймауту или изолят погасили после ответа, строка
 * остаётся `received` навсегда, а покупатель — без ответа (v1: 69
 * потерянных событий Instagram). Крон берёт такие строки старше трёх
 * минут и прогоняет тем же обработчиком: идемпотентность отправок —
 * по event_id (Idempotency-Key), так что повтор не удваивает ответ.
 */
export async function retryStuckEvents(
  ctx: TenantContext,
  now = new Date(),
  dispatch: typeof dispatchZernioEvent = dispatchZernioEvent,
  limit = 20,
): Promise<RetryResult> {
  const res: RetryResult = { found: 0, processed: 0, failed: 0, ignored: 0 };
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("event_id, event_type, payload")
    .eq("status", "received")
    .in("event_type", [...HANDLED_EVENTS])
    .lt("created_at", new Date(now.getTime() - STUCK_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`zernio_logs: ${error.message}`);
  for (const row of data ?? []) {
    if (!row.event_id) continue;
    res.found++;
    // Забираем строку: второй запуск крона её не возьмёт.
    const { data: claimed } = await ctx.db
      .from("zernio_logs")
      .update({ status: "retrying" })
      .eq("event_id", row.event_id)
      .eq("status", "received")
      .select("event_id");
    if (!claimed?.length) continue;
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
    try {
      const r = await retryStuckEvents(tenantContext(t));
      if (r.found) out[t.id] = r;
    } catch (e) {
      out[t.id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}
