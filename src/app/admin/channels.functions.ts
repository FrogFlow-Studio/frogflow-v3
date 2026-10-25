import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Настройки автоответчика Instagram Direct / WhatsApp (core/instagram/
 * direct-bot-settings). Читает любой сотрудник, меняет владелец.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminLevel = async () => (await import("@/app/auth/guards.server")).requireAdminRole("admin");
const platform = z.enum(["instagram", "whatsapp"]);

export const directBotSettingsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ platform }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { loadDirectBotSettings } = await import("@/core/instagram/direct-bot-settings");
    return loadDirectBotSettings(ctx, data.platform);
  });

export const saveDirectBotSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        platform,
        enabled: z.boolean(),
        scope: z.enum(["purchases", "all"]),
        triggers: z.string().max(2000),
        script: z.string().max(2000),
        features: z.object({
          catalog: z.boolean(),
          search: z.boolean(),
          cart: z.boolean(),
          checkout: z.boolean(),
          express: z.boolean().optional(),
          buy_button: z.boolean().optional(),
        }),
        sellerPause: z.enum(["15", "30", "60", "day"]).optional(),
        ignoreExcluded: z.boolean().optional(),
        notifyTemplate: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { parseTriggerWords, saveDirectBotSettings } =
      await import("@/core/instagram/direct-bot-settings");
    await saveDirectBotSettings(ctx, data.platform, {
      enabled: data.enabled,
      scope: data.scope,
      triggers: parseTriggerWords(data.triggers),
      script: data.script,
      features: { express: true, buy_button: true, ...data.features },
      sellerPause: data.sellerPause ?? "30",
      ignoreExcluded: data.ignoreExcluded ?? false,
      notifyTemplate: data.notifyTemplate ?? "",
    });
    // Тумблер и части магазина решают, какие быстрые вопросы видны в Instagram.
    if (data.platform === "instagram") {
      const { refreshIceBreakers } = await import("@/channels/zernio/ice-breakers.server");
      await refreshIceBreakers(ctx.tenant.id);
    }
    return { ok: true };
  });

/**
 * Быстрые вопросы Instagram (core/instagram/ice-breakers): набор и тексты.
 * После сохранения сразу приводим подсказки в аккаунтах к настройке; сбой
 * Zernio не отменяет сохранение — продавцу говорим, крон повторит.
 */
export const iceBreakersFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { loadIceBreakers } = await import("@/core/instagram/ice-breakers");
  return loadIceBreakers(ctx);
});

export const saveIceBreakersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        items: z
          .array(
            z.object({
              kind: z.enum(["catalog", "orders", "pay", "contact"]),
              question: z.string().max(200),
              on: z.boolean(),
            }),
          )
          .max(4),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { saveIceBreakers } = await import("@/core/instagram/ice-breakers");
    await saveIceBreakers(ctx, data);
    const { refreshIceBreakers } = await import("@/channels/zernio/ice-breakers.server");
    const r = await refreshIceBreakers(ctx.tenant.id);
    return { ok: true, applied: r.ok };
  });

/**
 * «Проверить бота» (Telegram): токен, вебхук, события, команды — только чтение.
 * «Починить» — та же установка вебхука и команд, что при подключении; её
 * делает владелец.
 */
export const checkBotFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { checkBot } = await import("@/channels/telegram/bot-check.server");
  return checkBot(ctx.tenant);
});

export const repairBotFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminLevel();
  const { repairBot } = await import("@/channels/telegram/bot-check.server");
  return repairBot(ctx.tenant.id, "admin");
});
