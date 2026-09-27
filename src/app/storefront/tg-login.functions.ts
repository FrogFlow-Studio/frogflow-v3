import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { shownError } from "@/lib/shown-error";
import type { Locale } from "@/core/i18n/locale";

/**
 * Вход покупателя на витрину через Telegram (виджет Telegram от бота
 * магазина, внутри Telegram — initData Mini App) и «Мои заказы» на сайте.
 * Только клиенты v2 с включённым оформлением на сайте и включённым входом.
 */
const slug = z.string().regex(SHOP_SLUG_RE);

async function shopT(ctx: { tenant: { settings: { default_locale?: Locale } } }) {
  const { storefrontT } = await import("@/app/i18n/storefront");
  return storefrontT(ctx.tenant.settings.default_locale ?? "ru");
}

/** Магазин, где вход через Telegram есть, или null. Клиент прежней платформы — null. */
async function loginCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  if (!t || !storefrontOpen(t, "web_checkout")) return null;
  const ctx = tenantContext(t);
  const { tgLoginAvailable } = await import("./tg-login.server");
  return (await tgLoginAvailable(ctx)) ? ctx : null;
}

async function buyerName(
  ctx: NonNullable<Awaited<ReturnType<typeof loginCtx>>>,
  telegramId: number,
) {
  const { getCustomer, userKey } = await import("@/core/customers/customers");
  const c = await getCustomer(ctx, userKey("telegram", telegramId));
  return (
    [c?.firstName, c?.lastName].filter(Boolean).join(" ") ||
    (c?.username ? `@${c.username}` : "Telegram")
  );
}

/** Есть ли кнопка входа, от какого бота, и кто вошёл. */
export const tgLoginStateFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await loginCtx(data.slug);
    if (!ctx) return { available: false as const, bot: null, me: null };
    const { buyerTelegramId } = await import("./tg-login.server");
    const tgId = await buyerTelegramId(ctx);
    return {
      available: true as const,
      bot: ctx.tenant.settings.telegram?.username ?? null,
      me: tgId === null ? null : { name: await buyerName(ctx, tgId) },
    };
  });

/** Поля виджета: только строки, их немного и они короткие. */
const widgetFields = z
  .record(z.string().regex(/^[a-z_]{1,32}$/), z.string().max(512))
  .refine((r) => Object.keys(r).length <= 16);

export const tgLoginFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        widget: widgetFields.optional(),
        initData: z.string().min(1).max(8000).optional(),
      })
      .refine((v) => Boolean(v.widget) !== Boolean(v.initData))
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await loginCtx(data.slug);
    if (!ctx) throw notFound();
    const t = await shopT(ctx);
    const { clientIp } = await import("@/app/auth/login-guard.server");
    const { takeWeb } = await import("@/core/storefront/checkout-guard");
    if (!(await takeWeb(ctx, "tgLogin", clientIp() ?? "unknown")))
      throw shownError(t("error.tooManyRequests"));
    const token = ctx.secrets.telegramToken();
    // Внутри Telegram — та же проверка initData, что у Mini App.
    const { validateInitData } = await import("@/core/storefront/init-data");
    const { validateLoginWidget } = await import("@/core/storefront/tg-login");
    const v = data.widget
      ? validateLoginWidget(data.widget, token)
      : validateInitData(data.initData!, token);
    if (!v.ok) throw shownError(t(v.reason === "expired" ? "login.expired" : "login.failed"));
    const { upsertCustomer } = await import("@/core/customers/customers");
    await upsertCustomer(ctx, "telegram", v.user.id, {
      username: v.user.username,
      firstName: v.user.first_name,
      lastName: v.user.last_name,
      languageCode: v.user.language_code,
    });
    const { startBuyerSession } = await import("./tg-login.server");
    startBuyerSession(ctx, v.user.id);
    return { name: await buyerName(ctx, v.user.id) };
  });

export const tgLogoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { servedByV2 } = await import("@/core/tenant/directory");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    // Выйти можно и после того, как продавец выключил вход; клиента v1 не трогаем.
    if (!t || !servedByV2(t)) return { ok: true };
    const { endBuyerSession } = await import("./tg-login.server");
    endBuyerSession(tenantContext(t));
    return { ok: true };
  });

/**
 * «Мои заказы» на сайте для вошедшего покупателя: те же список и библиотека,
 * что в Mini App. Не вошёл — null. Страница заказа по-прежнему открывается
 * только по личной ссылке: список ссылок на неё не даёт.
 */
export const webMyOrdersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ slug, libraryOffset: z.number().int().min(0).max(100_000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await loginCtx(data.slug);
    if (!ctx) return null;
    const { buyerTelegramId } = await import("./tg-login.server");
    const tgId = await buyerTelegramId(ctx);
    if (tgId === null) return null;
    const { takeWeb } = await import("@/core/storefront/checkout-guard");
    if (!(await takeWeb(ctx, "myOrders", String(tgId))))
      throw shownError((await shopT(ctx))("error.tooManyRequests"));
    const { buyerOrders } = await import("./buyer-orders.server");
    return buyerOrders(ctx, tgId, data.libraryOffset ?? 0);
  });
