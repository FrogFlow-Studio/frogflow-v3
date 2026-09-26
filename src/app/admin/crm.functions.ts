import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/** Интеграция с CRM и Таблицами (модуль crm_integration): адрес, секрет, события, проверка. */
const moduleAdmin = async (min?: "owner") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("crm_integration", min);

export const crmFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { loadCrm, CRM_EVENTS } = await import("@/core/crm/webhook");
  const cfg = await loadCrm(ctx);
  return {
    url: cfg?.url ?? "",
    hasSecret: Boolean(cfg?.secret),
    events: cfg?.events ?? [...CRM_EVENTS],
    all: [...CRM_EVENTS],
  };
});

export const saveCrmFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        url: z.string().max(2000),
        /** null — оставить прежний секрет. */
        secret: z.string().max(200).nullable(),
        events: z.array(z.string()).max(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("owner");
    const { loadCrm, parseCrm, saveCrm, safeWebhookUrl } = await import("@/core/crm/webhook");
    if (!data.url.trim()) {
      await saveCrm(ctx, null);
      return { ok: true };
    }
    if (!safeWebhookUrl(data.url.trim()))
      throw new UserError(
        "err.admin.crmUrl",
        "Адрес должен начинаться с https:// и вести на внешний сервер.",
      );
    const prev = await loadCrm(ctx);
    const cfg = parseCrm(
      JSON.stringify({
        url: data.url.trim(),
        secret: data.secret ?? prev?.secret ?? "",
        events: data.events,
      }),
    );
    await saveCrm(ctx, cfg);
    return { ok: true };
  });

/** Тестовое событие — сразу, без очереди: продавец видит ответ своей CRM. */
export const testCrmFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await moduleAdmin("owner");
  const { loadCrm } = await import("@/core/crm/webhook");
  const cfg = await loadCrm(ctx);
  if (!cfg) throw new UserError("err.admin.crmSaveFirst", "Сначала сохраните адрес вебхука.");
  const { postWebhook } = await import("@/app/outbox/senders.server");
  const body = JSON.stringify({
    event: "test",
    at: new Date().toISOString(),
    shop_id: ctx.tenant.id,
    order: { id: 0, number: 0, status: "test", total: 0, currency: "KZT", items: [] },
  });
  return postWebhook(ctx, cfg.url, body);
});
