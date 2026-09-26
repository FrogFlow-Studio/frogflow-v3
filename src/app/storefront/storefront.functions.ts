import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Locale } from "@/core/i18n/locale";
import type { StorefrontPart } from "@/core/storefront/access";

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
    return {
      ...(await storeInfo(ctx)),
      paused: ctx.tenant.status !== "active",
      /** Язык витрины — язык магазина; покупатель может сменить его через `?lang=`. */
      locale: (ctx.tenant.settings.default_locale ?? "ru") as Locale,
    };
  });

export const storeCatalogFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ slug, q: z.string().max(80).optional(), category: z.string().uuid().optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "catalog");
    const { storeCatalog } = await import("@/core/storefront/catalog");
    return storeCatalog(ctx, { q: data.q, categoryId: data.category ?? null });
  });

export const storeProductFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "catalog");
    const { storeProduct, storeCatalog } = await import("@/core/storefront/catalog");
    const product = await storeProduct(ctx, data.id);
    if (!product) throw new Error((await shopT(ctx))("error.productNotFound"));
    const related = (await storeCatalog(ctx, { categoryId: product.categoryIds[0] ?? null }))
      .filter((p) => p.id !== product.id)
      .slice(0, 4);
    return { product, related };
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

/** Корзина с сайта → ссылка в Telegram-бота, где продолжится оформление. */
export const createHandoffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ slug, items }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "web_handoff");
    const { createHandoff, parseHandoffItems } = await import("@/core/storefront/handoff");
    const r = await createHandoff(ctx, parseHandoffItems(data.items));
    if (!r) throw new Error((await shopT(ctx))("error.noBot"));
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
      throw new Error(
        (await shopT(ctx))(v.reason === "expired" ? "error.miniAppExpired" : "error.miniAppAuth"),
      );
    const { upsertCustomer } = await import("@/core/customers/customers");
    const { importItems, parseHandoffItems } = await import("@/core/storefront/handoff");
    const customer = await upsertCustomer(ctx, "telegram", v.user.id, {
      username: v.user.username,
      firstName: v.user.first_name,
      lastName: v.user.last_name,
      languageCode: v.user.language_code,
    });
    const imported = await importItems(ctx, customer, parseHandoffItems(data.items));
    if (imported === 0) throw new Error((await shopT(ctx))("error.nothingImported"));
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
export const miniAppOrdersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ slug, initData: z.string().min(1).max(8000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug, "mini_app");
    const t = await shopT(ctx);
    if (!ctx.tenant.telegramTokenEnc) throw new Error(t("error.noBot"));
    const { validateInitData } = await import("@/core/storefront/init-data");
    const v = validateInitData(data.initData, ctx.secrets.telegramToken());
    if (!v.ok)
      throw new Error(t(v.reason === "expired" ? "error.miniAppExpired" : "error.miniAppAuth"));
    const { getCustomerByTelegramId } = await import("@/core/customers/customers");
    const customer = await getCustomerByTelegramId(ctx, v.user.id);
    if (!customer) return { orders: [], library: [] };
    const { listCustomerOrders, itemLanguages, itemMaterials, signedFileUrl, displayNo } =
      await import("@/core/orders/orders");
    const { parseDeliveredLanguages } = await import("@/core/catalog/materials");
    const { protectMaterials } = await import("@/core/delivery/watermark.server");
    const orders = await listCustomerOrders(ctx, customer, 30);
    const library: Array<{ orderNo: number; item: string; name: string; url: string }> = [];
    for (const o of orders) {
      if (o.status !== "delivered") continue;
      for (const item of o.order_items ?? []) {
        const delivered = parseDeliveredLanguages(item.delivered_language);
        const langs = itemLanguages(item).filter((l) => delivered.size === 0 || delivered.has(l));
        for (const l of langs)
          for (const mat of await protectMaterials(ctx, o, itemMaterials(item, l))) {
            const url = mat.url ?? (mat.path ? await signedFileUrl(mat.path, 7 * 24 * 3600) : null);
            if (url)
              library.push({
                orderNo: displayNo(o),
                item: item.name_snapshot,
                name: mat.name ?? item.name_snapshot,
                url,
              });
          }
      }
    }
    return {
      orders: orders.map((o) => ({
        id: o.id,
        no: displayNo(o),
        status: o.status,
        total: Number(o.total),
        currency: o.currency,
        createdAt: o.created_at,
        items: (o.order_items ?? []).map((i) => ({ name: i.name_snapshot, qty: i.quantity })),
      })),
      library,
    };
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
