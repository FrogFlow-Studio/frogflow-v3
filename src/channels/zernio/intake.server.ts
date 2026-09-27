import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { ZernioWebhookMessagePayload } from "./message";
import type { DispatchOutcome } from "./dispatch.server";

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
  /** Магазин найден по профилю: записать новые id аккаунтов и вернуть свежего арендатора. */
  resync: (tenant: Tenant) => Promise<Tenant>;
};

export type IntakeResult = { status: number; body: string };

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
export async function intakeZernioEvent(
  payload: ZernioWebhookMessagePayload,
  deps: IntakeDeps,
): Promise<IntakeResult> {
  const account = payload.account;
  const accountId = account?.accountId || account?.id || account?._id || null;
  const profileId = account?.profileId || null;
  const eventId = payload.id ?? null;
  if ((!accountId && !profileId) || !eventId) return { status: 202, body: "accepted" };

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

  await deps.background(async () => {
    if (!(await deps.claim(ctx, eventId))) return;
    let run = ctx;
    if (found.via === "profile") {
      // Аккаунт переподключён, новый id ещё не записан: записываем сразу, не
      // дожидаясь сверки. Не вышло — событие всё равно обрабатываем.
      run = await deps
        .resync(found.tenant)
        .then(deps.tenantContext)
        .catch(() => ctx);
    }
    await deps.settle(run, eventId, await deps.dispatch(run, eventId, payload));
  });
  return { status: 200, body: "ok" };
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
    claim: (ctx, eventId) => dispatchMod.claimZernioEvent(ctx, eventId),
    dispatch: dispatchMod.dispatchZernioEvent,
    settle: dispatchMod.settleZernioEvent,
    resync: async (tenant) => {
      const { syncAccounts } = await import("./connect.server");
      await syncAccounts(tenant);
      const fresh = await resolveMod.tenantDirectory(true);
      return fresh.find((t) => t.id === tenant.id) ?? tenant;
    },
  };
}
