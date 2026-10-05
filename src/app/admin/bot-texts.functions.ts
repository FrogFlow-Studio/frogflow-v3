import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { BOT_TEXT_CHANNELS, BOT_TEXT_KEYS, BOT_TEXT_MAX } from "@/core/bot-texts/registry";

/**
 * «Тексты бота»: чтение открыто ролям магазина (кроме бухгалтера), запись
 * только владельцу. В Telegram ничего не отправляется.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminLevel = async () => (await import("@/app/auth/guards.server")).requireAdminRole("admin");

export const botTextsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { botTexts } = await import("./bot-texts.server");
  return botTexts(ctx);
});

const text = z
  .string()
  .max(BOT_TEXT_MAX * 2)
  .nullable();

export const saveBotTextFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.enum(BOT_TEXT_KEYS),
        channel: z.enum(BOT_TEXT_CHANNELS),
        texts: z.object(
          Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, text.optional()])) as Record<
            (typeof SUPPORTED_LOCALES)[number],
            z.ZodOptional<typeof text>
          >,
        ),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { saveBotText } = await import("./bot-texts.server");
    await saveBotText(ctx, data);
    return { ok: true };
  });

export const saveWorkHoursFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        hours: z
          .object({ open: z.number().int().min(0).max(24), close: z.number().int().min(0).max(24) })
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { saveWorkHours } = await import("./bot-texts.server");
    return { ok: true, hours: await saveWorkHours(ctx, data.hours) };
  });
