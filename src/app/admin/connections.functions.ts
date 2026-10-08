import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: подключение Telegram и Zernio (Instagram, WhatsApp).
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Настройки магазина — владельцу и администратору; тариф, платежи, команда и удаление — только владельцу. */
const adminLevel = async () => (await import("@/app/auth/guards.server")).requireAdminRole("admin");

/* ── Telegram из админки ─────────────────────────────────────────── */

export const telegramStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { webhookState } = await import("@/app/operator/operator.server");
  return {
    connected: Boolean(ctx.tenant.telegramTokenEnc),
    username: ctx.tenant.settings.telegram?.username ?? null,
    servedBy: ctx.tenant.settings.served_by ?? null,
    webhook: await webhookState(ctx.tenant.id),
  };
});

/** Instagram и WhatsApp: подключённые аккаунты Zernio из снимка в настройках клиента. */
export const zernioStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { zernioConfigured } = await import("@/channels/zernio/api.server");
  const z = ctx.tenant.settings.zernio;
  return {
    configured: zernioConfigured(),
    accounts: z?.accounts ?? [],
    manualIds: (z?.account_ids ?? []).filter((id) => !(z?.accounts ?? []).some((a) => a.id === id)),
    syncedAt: z?.synced_at ?? null,
  };
});

export const zernioConnectLinkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ platform: z.enum(["instagram", "whatsapp"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    if (!ctx.tenant.modules[data.platform])
      throw new UserError(
        "err.admin.channelOff",
        "Этот канал не подключён к вашему тарифу — оставьте заявку в «Модулях».",
      );
    const { connectLink } = await import("@/channels/zernio/connect.server");
    return { url: await connectLink(ctx.tenant, data.platform) };
  });

export const syncZernioAccountsFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminLevel();
  const { syncAccounts } = await import("@/channels/zernio/connect.server");
  const r = await syncAccounts(ctx.tenant);
  // Новый аккаунт Instagram получает быстрые вопросы сразу, а не с кроном.
  const { refreshIceBreakers } = await import("@/channels/zernio/ice-breakers.server");
  await refreshIceBreakers(ctx.tenant.id);
  return r;
});

const wizardPlatform = z.object({ platform: z.enum(["instagram", "whatsapp"]) });

/** Мастер подключения канала: что записано (без обращений к Zernio). */
export const wizardStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { wizardSnapshot } = await import("@/channels/zernio/wizard.server");
  return { entries: wizardSnapshot(ctx) };
});

/** Шаг «войдите»: ссылка входа Zernio или причина, почему её нет (только владелец). */
export const wizardStartFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => wizardPlatform.parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    if (!ctx.tenant.modules[data.platform])
      throw new UserError(
        "err.admin.channelOff",
        "Этот канал не подключён к вашему тарифу — оставьте заявку в «Модулях».",
      );
    const { startWizard } = await import("@/channels/zernio/wizard.server");
    return startWizard(ctx, data.platform);
  });

/** «Проверить»: аккаунт, вебхук и тестовое сообщение; ставит мастер на нужный шаг. */
export const wizardCheckFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => wizardPlatform.parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    if (!ctx.tenant.modules[data.platform])
      throw new UserError(
        "err.admin.channelOff",
        "Этот канал не подключён к вашему тарифу — оставьте заявку в «Модулях».",
      );
    const { checkWizard } = await import("@/channels/zernio/wizard.server");
    return checkWizard(ctx, data.platform);
  });

/**
 * Отключить Instagram или WhatsApp от магазина (только владелец): бот
 * перестаёт отвечать и слать в этот аккаунт, можно подключить другой.
 * Переписка, заказы и покупатели остаются.
 */
export const disconnectZernioAccountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { disconnectAccount } = await import("@/channels/zernio/connect.server");
    return disconnectAccount(ctx.tenant, data.accountId);
  });

/** Продавец подключает бота сам: токен → getMe → шифрование → вебхук на эту платформу. */
export const connectTelegramAdminFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ token: z.string().regex(/^\d+:[\w-]{30,}$/, "Не похоже на токен BotFather") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { connectTelegram, setServedBy } = await import("@/app/operator/operator.server");
    const r = await connectTelegram(ctx.tenant.id, data.token, "admin");
    const webhook = await setServedBy(ctx.tenant.id, "v2", "admin");
    return { username: r.username, webhook };
  });
