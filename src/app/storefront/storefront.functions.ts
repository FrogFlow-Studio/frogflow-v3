import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Витрина и Mini App: публичные серверные функции. Арендатор — по slug из
 * адреса; ничего приватного не отдаём, всё под ключом арендатора.
 */
const slug = z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,39}$/);

async function shopCtx(s: string) {
  const { requireTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const t = await requireTenant({ by: "slug", value: s });
  if (t.archived || !t.modules.shop) throw new Error("Магазин не найден");
  return tenantContext(t);
}

export const storeInfoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug);
    const { storeInfo } = await import("@/core/storefront/catalog");
    return { ...(await storeInfo(ctx)), paused: ctx.tenant.status !== "active" };
  });

export const storeCatalogFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ slug, q: z.string().max(80).optional(), category: z.string().uuid().optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug);
    const { storeCatalog } = await import("@/core/storefront/catalog");
    return storeCatalog(ctx, { q: data.q, categoryId: data.category ?? null });
  });

export const storeProductFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug);
    const { storeProduct, storeCatalog } = await import("@/core/storefront/catalog");
    const product = await storeProduct(ctx, data.id);
    if (!product) throw new Error("Товар не найден");
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
    const ctx = await shopCtx(data.slug);
    const { createHandoff, parseHandoffItems } = await import("@/core/storefront/handoff");
    const r = await createHandoff(ctx, parseHandoffItems(data.items));
    if (!r) throw new Error("У магазина ещё не подключён Telegram-бот — напишите продавцу.");
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
    const ctx = await shopCtx(data.slug);
    const { validateInitData } = await import("@/core/storefront/init-data");
    const v = validateInitData(data.initData, ctx.secrets.telegramToken());
    if (!v.ok)
      throw new Error(
        v.reason === "expired"
          ? "Сессия Mini App устарела — откройте магазин заново."
          : "Не удалось подтвердить Telegram-аккаунт.",
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
    if (imported === 0)
      throw new Error("Ни один товар не удалось положить в корзину — возможно, он снят с продажи.");
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

export const legalFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ slug, doc: z.enum(["offer", "privacy", "requisites", "about"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await shopCtx(data.slug);
    const { getSetting } = await import("@/core/settings/settings");
    const { storeInfo } = await import("@/core/storefront/catalog");
    const [text, info] = await Promise.all([getSetting(ctx, `legal_${data.doc}`), storeInfo(ctx)]);
    return { text, shop: info };
  });
