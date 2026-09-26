import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Настройки автоответчика Instagram Direct / WhatsApp (core/instagram/
 * direct-bot-settings). Читает любой сотрудник, меняет владелец.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminOwner = async () => (await import("@/app/auth/guards.server")).requireAdminRole("owner");
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
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { parseTriggerWords, saveDirectBotSettings } =
      await import("@/core/instagram/direct-bot-settings");
    await saveDirectBotSettings(ctx, data.platform, {
      enabled: data.enabled,
      scope: data.scope,
      triggers: parseTriggerWords(data.triggers),
      script: data.script,
      features: data.features,
    });
    return { ok: true };
  });
