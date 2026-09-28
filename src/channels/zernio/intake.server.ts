import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { ZernioWebhookMessagePayload } from "./message";
import type { DispatchOutcome } from "./dispatch.server";
import { runNotingEffects } from "@/lib/external-effects";
import type { InboundVerdict } from "@/core/customers/inbound-rate";

export type IntakeDeps = {
  resolve: (
    accountId: string | null,
    profileId: string | null,
  ) => Promise<{ tenant: Tenant; via: "account" | "profile" } | null>;
  tenantContext: (t: Tenant) => TenantContext;
  /** Задача после ответа (на Vercel — waitUntil, lib/background). */
  background: (task: () => Promise<void>) => Promise<void>;
  claim: (ctx: TenantContext, eventId: string) => Promise<boolean>;
  dispatch: (
    ctx: TenantContext,
    eventId: string,
    payload: ZernioWebhookMessagePayload,
  ) => Promise<DispatchOutcome>;
  settle: (ctx: TenantContext, eventId: string, r: DispatchOutcome) => Promise<void>;
  /** Отметка на строке журнала перед первой отправкой наружу. */
  markSending: (ctx: TenantContext, eventId: string) => Promise<void>;
  /** Лимит частоты входящих от покупателя (core/customers/inbound-rate). */
  admit: (ctx: TenantContext, payload: ZernioWebhookMessagePayload) => Promise<InboundVerdict>;
  /** Уведомить продавца о покупателе сверх лимита (раз в час на покупателя). */
  notifyFlood: (ctx: TenantContext, payload: ZernioWebhookMessagePayload) => Promise<void>;
  /** Магазин найден по профилю: записать новые id аккаунтов и вернуть свежего арендатора. */
  resync: (tenant: Tenant) => Promise<Tenant>;
};

export type IntakeResult = { status: number; body: string };

export const FLOOD_NOTE = "частые сообщения";

/**
 * Приём события Zernio после проверки подписи. Zernio ждёт ответа 2xx не
 * дольше 5 секунд, иначе считает доставку неудачной, повторяет и через 3 дня
 * без успешных доставок отключает вебхук. Поэтому здесь только быстрые шаги:
 * найти магазин, записать строку журнала `received` (уникальный event_id —
 * повторная доставка отсекается вставкой) и ответить. Обработка — в фоне:
 * она забирает строку условной записью (received → retrying), так что фон и
 * крон добора не обработают одно событие дважды. Если фон не дожил до
 * захвата, строку через 3 минуты подберёт добор.
 */
/** Событие старше недели — повтор перехваченного запроса, а не доставка. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 3600_000;

export function eventTooOld(
  payload: Pick<ZernioWebhookMessagePayload, "timestamp" | "message">,
  now = Date.now(),
): boolean {
  const at = Date.parse(payload.timestamp ?? payload.message?.sentAt ?? "");
  return Number.isFinite(at) && now - at > MAX_EVENT_AGE_MS;
}

export async function intakeZernioEvent(
  payload: ZernioWebhookMessagePayload,
  deps: IntakeDeps,
): Promise<IntakeResult> {
  const account = payload.account;
  const accountId = account?.accountId || account?.id || account?._id || null;
  const profileId = account?.profileId || null;
  const eventId = payload.id ?? null;
  if ((!accountId && !profileId) || !eventId) return { status: 202, body: "accepted" };
  // Подпись без времени: защита от повтора — строка журнала по event_id, а её
  // ретеншн снимает через 30 дней. Старое событие — не обрабатываем вовсе.
  if (eventTooOld(payload)) return { status: 202, body: "accepted" };

  const found = await deps.resolve(accountId, profileId);
  if (!found || found.tenant.settings.served_by !== "v2") return { status: 202, body: "accepted" };
  const ctx = deps.tenantContext(found.tenant);

  const { isHandledEvent } = await import("./dispatch.server");
  const handled = isHandledEvent(payload.event);
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: found.tenant.id,
    event_id: eventId,
    event_type: payload.event ?? "unknown",
    status: handled ? "received" : "ignored",
    payload: payload as never,
    error_message: handled ? null : "v2: событие не обрабатывается",
  });
  if (error) {
    // Конфликт по event_id — повторная доставка, уже принято.
    if (/duplicate|unique/i.test(error.message)) return { status: 200, body: "ok" };
    return { status: 500, body: "error" };
  }
  if (!handled) return { status: 200, body: "ok" };

  // Сверх лимита частоты — строка журнала ignored с причиной: ни фон, ни
  // добор (он берёт received) событие не обработают.
  if (payload.event === "message.received") {
    const verdict = await deps.admit(ctx, payload);
    if (verdict !== "ok") {
      const { error: markError } = await ctx.db
        .from("zernio_logs")
        .update({ status: "ignored", error_message: FLOOD_NOTE })
        .eq("event_id", eventId)
        .eq("status", "received");
      // Не пометили — строка осталась received, и через 3 минуты её обработает
      // добор: лишнее сообщение лучше потерянного. Сбой — в Sentry.
      if (markError) {
        const { reportError } = await import("@/lib/errors");
        await reportError(new Error(`zernio_logs: ${markError.message}`), {
          where: "zernio.flood",
          botId: found.tenant.id,
          extra: { event_id: eventId },
        });
      }
      if (verdict === "limited_notify") await deps.background(() => deps.notifyFlood(ctx, payload));
      return { status: 200, body: "ok" };
    }
  }

  await deps.background(async () => {
    if (!(await deps.claim(ctx, eventId))) return;
    let run = ctx;
    if (found.via === "profile") {
      // Аккаунт переподключён, новый id ещё не записан: записываем сразу, не
      // дожидаясь сверки. Не вышло — событие всё равно обрабатываем, а сбой
      // сверки (чтение или запись settings) уходит в Sentry, а не теряется.
      run = await deps
        .resync(found.tenant)
        .then(deps.tenantContext)
        .catch(async (e) => {
          const { reportError } = await import("@/lib/errors");
          await reportError(e, {
            where: "zernio.resync",
            botId: found.tenant.id,
            extra: { event_id: eventId },
          });
          return ctx;
        });
    }
    // Отметка перед первой отправкой: брошенное после неё событие добор не повторит.
    const r = await runNotingEffects(
      () => deps.markSending(ctx, eventId),
      () => deps.dispatch(run, eventId, payload),
    );
    await deps.settle(run, eventId, r);
  });
  return { status: 200, body: "ok" };
}

/**
 * Лимит частоты для входящего сообщения покупателя. Исходящие эхо (ответы
 * бота, продавец пишет из приложения, рассылки) тоже приходят как
 * message.received, а отправитель у них берётся из собеседника — это id
 * покупателя. Их не считаем: иначе ответ консультанта с фото или переписка
 * продавца выбирали бы лимит покупателя.
 */
export async function admitZernioInbound(
  ctx: TenantContext,
  payload: ZernioWebhookMessagePayload,
): Promise<InboundVerdict> {
  const { parseZernioMessage } = await import("./message");
  const m = parseZernioMessage(payload);
  if (m.outgoing || m.senderId === "unknown") return "ok";
  const { admitInbound } = await import("@/core/customers/inbound-rate");
  return admitInbound(ctx, `${m.platform}_${m.senderId}`);
}

/** Боевые зависимости приёма: справочник, фон на waitUntil, добор и сверка аккаунтов. */
export async function liveIntakeDeps(): Promise<IntakeDeps> {
  const [resolveMod, dispatchMod, { runInBackground }] = await Promise.all([
    import("@/core/tenant/resolve.server"),
    import("./dispatch.server"),
    import("@/lib/background"),
  ]);
  return {
    resolve: resolveMod.resolveZernioTenant,
    tenantContext: resolveMod.tenantContext,
    background: (task) => runInBackground(task, "zernio.webhook"),
    claim: (ctx, eventId) => dispatchMod.claimZernioEvent(ctx, eventId, new Date(), "webhook"),
    dispatch: dispatchMod.dispatchZernioEvent,
    settle: dispatchMod.settleZernioEvent,
    markSending: (ctx, eventId) => dispatchMod.markZernioEventSending(ctx, eventId),
    admit: admitZernioInbound,
    notifyFlood: async (ctx, payload) => {
      const [{ parseZernioMessage }, { PLATFORM_LABEL }, { floodNoticeHtml }, notify, copy] =
        await Promise.all([
          import("./message"),
          import("./platform"),
          import("@/core/customers/inbound-rate"),
          import("@/channels/telegram/notify"),
          import("@/channels/telegram/copy"),
        ]);
      const m = parseZernioMessage(payload);
      const who = m.senderUsername ? `@${m.senderUsername}` : m.senderName || m.senderId;
      await notify.notifyAdminsHtml(
        ctx,
        floodNoticeHtml(PLATFORM_LABEL[m.platform], copy.escapeHtml(who)),
        { kind: "system" },
      );
    },
    resync: async (tenant) => {
      const { resyncAfterReconnect } = await import("./connect.server");
      if (!(await resyncAfterReconnect(tenant))) return tenant;
      const fresh = await resolveMod.tenantDirectory(true);
      return fresh.find((t) => t.id === tenant.id) ?? tenant;
    },
  };
}
