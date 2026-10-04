import { UserError } from "@/core/i18n/user-error";

/** Не чаще раза в 10 секунд на магазин. */
export const CRM_PING_GAP_MS = 10_000;
const PING_KEY = "crm_ping_at";

/**
 * «Проверить вебхук»: событие `ping` с той же подписью и теми же заголовками,
 * что у настоящих, — сразу, без очереди; продавец видит код ответа своей CRM.
 * Метка последней проверки пишется условно (updateSettingAtomic): две
 * одновременные кнопки не пройдут обе.
 */
export async function sendCrmPing(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  now = new Date(),
) {
  const { loadCrm } = await import("@/core/crm/webhook");
  const cfg = await loadCrm(ctx);
  if (!cfg) throw new UserError("err.admin.crmSaveFirst", "Сначала сохраните адрес вебхука.");
  const { updateSettingAtomic } = await import("@/core/settings/settings");
  const stamp = await updateSettingAtomic(ctx, PING_KEY, (raw) =>
    raw && now.getTime() - Number(raw) < CRM_PING_GAP_MS ? null : String(now.getTime()),
  );
  if (stamp === "skipped")
    throw new UserError(
      "err.admin.crmPingWait",
      "Проверять вебхук можно не чаще раза в 10 секунд.",
    );
  if (stamp === "failed") {
    const { serverFailure } = await import("@/lib/server-failure");
    throw serverFailure("Проверка вебхука: метка не записалась");
  }
  const { postWebhook } = await import("@/app/outbox/senders.server");
  const { randomUUID } = await import("node:crypto");
  const body = JSON.stringify({
    event: "ping",
    event_id: randomUUID(),
    at: now.toISOString(),
    shop_id: ctx.tenant.id,
  });
  return postWebhook(ctx, cfg.url, body);
}
