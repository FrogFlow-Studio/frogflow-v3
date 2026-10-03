import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/** Уведомления продавцу: матрица «событие → канал», тихие часы, дайджест (core/notify/prefs). */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

export const notifyPrefsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { loadNotifyPrefs } = await import("@/core/notify/prefs");
  const { isMailConfigured } = await import("@/core/mail/mail.server");
  return { prefs: await loadNotifyPrefs(ctx), mail: isMailConfigured(), timezone: ctx.timezone };
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const saveNotifyPrefsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        kinds: z.record(z.string(), z.object({ telegram: z.boolean(), email: z.boolean() })),
        email: z.string().max(200),
        quiet: z.object({ from: time, to: time }).nullable(),
        digest: z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23) }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("notify_in_bot", "owner");
    const { NOTIFY_KINDS, defaultNotifyPrefs, saveNotifyPrefs, urgentWithoutTelegram } =
      await import("@/core/notify/prefs");
    // Срочное (заказ, сбой выдачи, жалоба) всегда идёт в Telegram: «только почта» его теряла бы.
    if (urgentWithoutTelegram(data.kinds).length)
      throw new UserError(
        "err.notify.urgentTelegram",
        "Срочные события (заказ, сбой выдачи, жалоба) нельзя отключить в Telegram: они всегда приходят туда, почта — дополнительно.",
      );
    const prefs = defaultNotifyPrefs();
    for (const k of NOTIFY_KINDS) if (data.kinds[k]) prefs.kinds[k] = data.kinds[k]!;
    prefs.email = data.email.trim();
    prefs.quiet = data.quiet;
    prefs.digest = data.digest;
    await saveNotifyPrefs(ctx, prefs);
    return { ok: true };
  });

/** Порог «заканчивается на складе» для магазина (core/catalog/low-stock); модуль «Склад», настраивает владелец. */
export const lowStockFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdminModule("stock");
  const { loadThresholds } = await import("@/core/catalog/low-stock");
  return { threshold: (await loadThresholds(ctx, null)).shop };
});

export const saveLowStockFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ threshold: z.number().int().min(0).max(100_000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("stock", "owner");
    const { saveShopThreshold } = await import("@/core/catalog/low-stock");
    await saveShopThreshold(ctx, data.threshold);
    return { ok: true };
  });
