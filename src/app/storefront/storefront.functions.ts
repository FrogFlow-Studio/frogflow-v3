import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import type { Locale } from "@/core/i18n/locale";
import type { StorefrontPart } from "@/core/storefront/access";
import { CATALOG_SORTS } from "@/core/storefront/sort";

/**
 * Витрина и Mini App: публичные серверные функции. Арендатор — по slug из
 * адреса; ничего приватного не отдаём, всё под ключом арендатора.
 */
const slug = z.string().regex(SHOP_SLUG_RE);

/** Переводчик ошибок, которые покупатель увидит на витрине, — на языке магазина. */
async function shopT(ctx: { tenant: { settings: { default_locale?: Locale } } }) {
  const { storefrontT } = await import("@/app/i18n/storefront");
  return storefrontT(ctx.tenant.settings.default_locale ?? "ru");
}

async function shopCtx(s: string, part: StorefrontPart) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  // Нет такого, клиент прежней платформы (его витрина живёт там) или без
  // оплаченного модуля — страница «Магазин не найден» с кодом 404, не 500.
  if (!t || !storefrontOpen(t, part)) throw notFound();
  return tenantContext(t);
}

export const storeInfoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "info");
    const { storeInfo } = await import("@/core/storefront/catalog");
    const { giftSaleOpen } = await import("@/core/discounts/gift-sale");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const { webCheckoutSettings } = await import("@/core/storefront/web-order");
    return {
      ...(await storeInfo(ctx)),
      /** Ссылка «Сертификат» в шапке: продажа сертификатов и оформление на сайте открыты. */
      giftSale:
        giftSaleOpen(ctx) &&
        storefrontOpen(ctx.tenant, "web_checkout") &&
        (await webCheckoutSettings(ctx)).enabled,
      paused: ctx.tenant.status !== "active",
      /** Язык витрины — язык магазина; покупатель может сменить его через `?lang=`. */
      locale: (ctx.tenant.settings.default_locale ?? "ru") as Locale,
    };
  });

export const storeCatalogFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        q: z.string().max(80).optional(),
        category: z.string().uuid().optional(),
        sort: z.enum(CATALOG_SORTS).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "catalog");
    const { storeCatalog } = await import("@/core/storefront/catalog");
    return storeCatalog(ctx, { q: data.q, categoryId: data.category ?? null, sort: data.sort });
  });

export const storeProductFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "catalog");
    const { storeProduct, storeCatalog } = await import("@/core/storefront/catalog");
    const product = await storeProduct(ctx, data.id);
    if (!product) throw shownError((await shopT(ctx))("error.productNotFound"));
    const related = (await storeCatalog(ctx, { categoryId: product.categoryIds[0] ?? null }))
      .filter((p) => p.id !== product.id)
      .slice(0, 4);
    // Пример цифрового товара (core/catalog/preview): публичные картинки.
    const { loadPreview } = await import("@/core/catalog/preview");
    const { imageUrl } = await import("@/core/catalog/catalog");
    const preview = (await loadPreview(ctx, product.id)).map((k) => imageUrl(ctx, k));
    // Курс (модуль courses): программа, поток, тарифы — как лендинг курса.
    const { coursePreview } = await import("@/core/courses/preview.server");
    const course =
      product.kind === "digital"
        ? await coursePreview(
            ctx,
            product.id,
            new Date(),
            // Файлы открытых уроков подписываются в момент перехода (core/courses/preview.server).
            (no, idx) => `/api/course-file/${data.slug}/${product.id}/${no}/${idx}`,
          )
        : null;
    // «Сообщить о поступлении»: ссылка в бота, только у товара без остатка (core/waitlist/link).
    const { waitlistLink } = await import("@/core/waitlist/link");
    const waitlistUrl = course
      ? null
      : waitlistLink(
          ctx.tenant.settings.telegram?.username,
          product,
          Boolean(ctx.tenant.modules.waitlist),
        );
    return { product, related, preview, course, waitlistUrl };
  });

const items = z
  .array(
    z.object({
      product_id: z.string().uuid(),
      product_variant_id: z.string().uuid().nullable().optional(),
      quantity: z.number().int().min(1).max(99),
    }),
  )
  .min(1)
  .max(40);

/**
 * «С этим берут» для корзины витрины и Mini App: те же правила, что в боте
 * (core/upsell). Корзина живёт в браузере, поэтому товары корзины приходят
 * списком; ответ — публичные карточки товаров, как в каталоге.
 */
export const storeUpsellFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ slug, ids: z.array(z.string().uuid()).min(1).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "catalog");
    const { storeUpsell } = await import("@/core/storefront/catalog");
    return storeUpsell(ctx, [...new Set(data.ids)]);
  });

/** Корзина с сайта → ссылка в Telegram-бота, где продолжится оформление. */
export const createHandoffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ slug, items }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "web_handoff");
    const { createHandoff, parseHandoffItems } = await import("@/core/storefront/handoff");
    const r = await createHandoff(ctx, parseHandoffItems(data.items));
    if (!r) throw shownError((await shopT(ctx))("error.noBot"));
    return { url: r.url };
  });

/**
 * Mini App: покупатель уже в Telegram, initData подписан токеном бота.
 * Позиции переносятся в его корзину напрямую, бот присылает корзину с
 * кнопкой «Оформить», Mini App закрывается.
 */
export const miniAppCheckoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ slug, initData: z.string().min(1).max(8000), items }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "mini_app");
    const { validateInitData } = await import("@/core/storefront/init-data");
    const v = validateInitData(data.initData, ctx.secrets.telegramToken());
    if (!v.ok)
      throw shownError(
        (await shopT(ctx))(v.reason === "expired" ? "error.miniAppExpired" : "error.miniAppAuth"),
      );
    // Счёт — по подписанному id: чужой бюджет подделкой не выесть.
    const { takeMiniApp } = await import("@/core/storefront/rate-limit");
    if (!(await takeMiniApp(ctx, v.user.id, "checkout")))
      throw shownError((await shopT(ctx))("error.tooManyRequests"));
    const { isBlocked, upsertCustomer } = await import("@/core/customers/customers");
    // Заблокированному бот не отвечает — и корзину из Mini App ему не шлём.
    if (await isBlocked(ctx, v.user.id))
      throw shownError((await shopT(ctx))("error.orderUnavailable"));
    const { importItems, parseHandoffItems } = await import("@/core/storefront/handoff");
    const customer = await upsertCustomer(ctx, "telegram", v.user.id, {
      username: v.user.username,
      firstName: v.user.first_name,
      lastName: v.user.last_name,
      languageCode: v.user.language_code,
    });
    const imported = await importItems(ctx, customer, parseHandoffItems(data.items));
    if (imported === 0) throw shownError((await shopT(ctx))("error.nothingImported"));
    const { env } = await import("@/config/env");
    const { telegramApi } = await import("@/channels/telegram/api");
    const { sendCartMessage } = await import("@/channels/telegram/handle-update");
    await sendCartMessage(
      ctx,
      telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE),
      customer,
    );
    return { ok: true, imported };
  });

/**
 * Mini App «Мои заказы» и библиотека материалов: покупатель подписан initData,
 * выданные позиции отдаются подписанными ссылками на 7 дней — то, что в v1
 * было отдельными экранами Mini App.
 */
export { LIBRARY_FILES } from "@/core/storefront/library";

export const miniAppOrdersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug,
        initData: z.string().min(1).max(8000),
        libraryOffset: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "mini_app");
    const t = await shopT(ctx);
    if (!ctx.tenant.telegramTokenEnc) throw shownError(t("error.noBot"));
    const { validateInitData } = await import("@/core/storefront/init-data");
    const v = validateInitData(data.initData, ctx.secrets.telegramToken());
    if (!v.ok)
      throw shownError(t(v.reason === "expired" ? "error.miniAppExpired" : "error.miniAppAuth"));
    const { takeMiniApp } = await import("@/core/storefront/rate-limit");
    if (!(await takeMiniApp(ctx, v.user.id, "orders")))
      throw shownError(t("error.tooManyRequests"));
    const { buyerOrders } = await import("./buyer-orders.server");
    return buyerOrders(ctx, v.user.id, data.libraryOffset ?? 0);
  });

/** «Мои баллы и приглашения» в Mini App: баланс, уровень, личная ссылка и итоги приглашений. */
export const miniAppRewardsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ slug, initData: z.string().min(1).max(8000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "mini_app");
    const t = await shopT(ctx);
    if (!ctx.tenant.telegramTokenEnc) throw shownError(t("error.noBot"));
    const { validateInitData } = await import("@/core/storefront/init-data");
    const v = validateInitData(data.initData, ctx.secrets.telegramToken());
    if (!v.ok)
      throw shownError(t(v.reason === "expired" ? "error.miniAppExpired" : "error.miniAppAuth"));
    const { takeMiniApp } = await import("@/core/storefront/rate-limit");
    if (!(await takeMiniApp(ctx, v.user.id, "orders")))
      throw shownError(t("error.tooManyRequests"));
    const { myRewards } = await import("@/core/storefront/my-rewards");
    return myRewards(ctx, v.user.id);
  });

export const legalFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ slug, doc: z.enum(["offer", "privacy", "requisites", "about"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "legal");
    const { getSetting } = await import("@/core/settings/settings");
    const { storeInfo } = await import("@/core/storefront/catalog");
    const [text, info] = await Promise.all([getSetting(ctx, `legal_${data.doc}`), storeInfo(ctx)]);
    return { text, shop: info };
  });
