import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import type { Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { formatMoney } from "@/core/money/money";

/**
 * Оформление заказа на витрине сайта, без мессенджера (модуль web_storefront
 * и включённая продавцом настройка). Покупатель анонимный, поэтому кроме
 * лимитов частоты — задача для браузера, как у регистрации. Страница заказа
 * и чек — только по подписанной ссылке, которую покупатель получил при
 * оформлении (и в письме).
 */
const slug = z.string().regex(SHOP_SLUG_RE);
const orderRef = { slug, id: z.number().int().positive(), t: z.string().max(64) };

async function shopT(ctx: { tenant: { settings: { default_locale?: Locale } } }) {
  const { storefrontT } = await import("@/app/i18n/storefront");
  return storefrontT(ctx.tenant.settings.default_locale ?? "ru");
}

/** Магазин, где оформление на сайте открыто: модуль, клиент v2, настройка продавца. */
async function checkoutCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  if (!t || !storefrontOpen(t, "web_checkout")) throw notFound();
  const ctx = tenantContext(t);
  const { webCheckoutSettings } = await import("@/core/storefront/web-order");
  if (!(await webCheckoutSettings(ctx)).enabled) throw notFound();
  return ctx;
}

async function secret() {
  const { env } = await import("@/config/env");
  return env().SESSION_SECRET;
}

/** Открыто ли оформление на сайте; страны оплаты и свежая задача для браузера. */
export const webCheckoutInfoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    let ctx;
    try {
      ctx = await checkoutCtx(data.slug);
    } catch {
      return { enabled: false as const };
    }
    const { listActivePaymentMethods } = await import("@/core/orders/orders");
    const { issueChallenge } = await import("@/app/signup/challenge");
    const { webFulfillmentOptions } = await import("@/core/storefront/web-fulfillment");
    const methods = await listActivePaymentMethods(ctx);
    const countries = [...new Map(methods.map((m) => [m.country_code, m.country_name])).entries()]
      .filter(([code]) => Boolean(code))
      .map(([code, name]) => ({ code, name: name || code }));
    const { legalConsentNeeded } = await import("@/core/storefront/consent");
    return {
      enabled: true as const,
      countries,
      /** Опубликованы оферта и/или политика — покупатель ставит галочку согласия. */
      consent: await legalConsentNeeded(ctx),
      fulfillment: await webFulfillmentOptions(ctx, countries[0]?.code ?? null),
      /** Поля кодов скидки — только при включённых модулях. */
      codes: {
        promo: Boolean(ctx.tenant.modules.coupons),
        gift: Boolean(ctx.tenant.modules.gift_certificates),
      },
      /** Минимальная сумма заказа в валюте магазина; страница сверяет её с корзиной в той же валюте. */
      minOrder: await minOrderInfo(ctx),
      challenge: issueChallenge(await secret(), Date.now(), "checkout"),
    };
  });

async function minOrderInfo(ctx: TenantContext) {
  const { loadMinOrder } = await import("@/core/cart/min-order");
  const amount = await loadMinOrder(ctx);
  if (amount === 0) return null;
  const { shopCurrency } = await import("@/core/discounts/discounts");
  return { amount, currency: await shopCurrency(ctx) };
}

const checkoutInput = z.object({
  slug,
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        product_variant_id: z.string().uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(40),
  name: z.string().trim().min(1).max(64),
  email: z.string().max(254),
  phone: z.string().max(32).optional(),
  country: z.string().regex(/^[A-Z]{2}$/),
  /** Только для физических товаров; проверяет сервер по корзине. */
  fulfillment: z
    .object({
      type: z.enum(["pickup", "delivery"]),
      date: z.string().max(10),
      slot: z.string().max(20).nullable().optional(),
      zoneId: z.string().uuid().nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    })
    .nullable()
    .optional(),
  promo: z.string().trim().max(40).optional(),
  gift: z.string().trim().max(40).optional(),
  /** Согласие с офертой и обработкой данных (галочка оформления). */
  consent: z.boolean().optional(),
  /** Приманка для ботов: поле скрыто, человек его не заполняет. */
  website: z.string().max(0).optional(),
  challenge: z.string().max(200),
  answer: z.string().max(20),
  /** Откуда пришёл (utm, ref), собрано браузером; мусор отбрасывается молча и заказ не срывает. */
  source: z.string().max(64).optional().catch(undefined),
});

export const webCheckoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => checkoutInput.parse(d))
  .handler(async ({ data }) => {
    const ctx = await checkoutCtx(data.slug);
    const t = await shopT(ctx);
    if (ctx.tenant.status !== "active") throw shownError(t("layout.paused"));
    const { CHALLENGE_TOO_FAST, challengeNonce, verifyChallenge, POW_BITS } =
      await import("@/app/signup/challenge");
    const bad = verifyChallenge(
      await secret(),
      data.challenge,
      data.answer,
      Date.now(),
      POW_BITS,
      "checkout",
    );
    if (bad)
      throw shownError(
        t(bad === CHALLENGE_TOO_FAST ? "checkout.error.tooFast" : "checkout.error.refresh"),
      );
    const { normalizeEmail } = await import("@/core/storefront/web-order");
    const email = normalizeEmail(data.email);
    if (!email) throw shownError(t("checkout.error.email"));
    // Галочка согласия проверяется и на сервере: без неё заказ не создаётся.
    const { legalConsentNeeded } = await import("@/core/storefront/consent");
    const consent = await legalConsentNeeded(ctx);
    if ((consent.offer || consent.privacy) && data.consent !== true)
      throw shownError(t("checkout.error.consent"));
    const { clientIp } = await import("@/app/auth/login-guard.server");
    const { claimCheckoutChallenge, takeWeb } = await import("@/core/storefront/checkout-guard");
    const ip = clientIp() ?? "unknown";
    const m = ctx.tenant.modules;
    const promoCode = m.coupons && data.promo ? data.promo : null;
    const giftCode = m.gift_certificates && data.gift ? data.gift : null;
    if (
      !(await takeWeb(ctx, "checkoutIp", ip)) ||
      !(await takeWeb(ctx, "checkoutEmail", email)) ||
      ((promoCode || giftCode) && !(await takeWeb(ctx, "code", ip)))
    )
      throw shownError(t("error.tooManyRequests"));
    const claimed = await claimCheckoutChallenge(ctx, challengeNonce(data.challenge)!);
    if (claimed === "used") throw shownError(t("checkout.error.refresh"));
    if (claimed === "failed") throw shownError(t("checkout.error.failed"));

    const { normalizePhone } = await import("@/channels/telegram/copy");
    const { parseHandoffItems } = await import("@/core/storefront/handoff");
    const { placeWebOrder, webCustomer, orderAccessToken } =
      await import("@/core/storefront/web-order");
    const phone = data.phone?.trim() ? normalizePhone(data.phone) : null;
    // Вошёл через Telegram — заказ ложится на покупателя из бота (одна карточка).
    const { buyerTelegramId } = await import("./tg-login.server");
    const tgId = await buyerTelegramId(ctx);
    const { telegramWebCustomer } = await import("@/core/storefront/web-order");
    const customer =
      (tgId !== null ? await telegramWebCustomer(ctx, tgId, email) : null) ??
      (await webCustomer(ctx, { email, name: data.name, phone }));
    // Заблокированный продавцом покупатель не оформляет и на сайте (в том числе
    // вошедший через Telegram — по его id из бота). Отказ нейтральный: не
    // подсказываем, что это блокировка.
    const { isBlocked } = await import("@/core/customers/customers");
    if (await isBlocked(ctx, customer.telegramId)) throw shownError(t("error.orderUnavailable"));
    const r = await placeWebOrder(ctx, customer, parseHandoffItems(data.items), data.country, {
      fulfillment: data.fulfillment,
      contact: { name: data.name, phone },
      promoCode,
      giftCode,
    });
    if (!r.ok) {
      switch (r.reason) {
        case "too_many": {
          const { WEB_MAX_QTY } = await import("@/core/storefront/web-order");
          throw shownError(t("checkout.error.tooMany", { n: WEB_MAX_QTY }));
        }
        case "missing":
        case "type":
        case "date":
        case "slot":
          throw shownError(t("checkout.error.fulfillment"));
        case "date_early": {
          const { isoToDisplay } = await import("@/core/fulfillment/pure");
          throw shownError(t("checkout.error.dateEarly", { date: isoToDisplay(r.minDate) }));
        }
        case "zone":
          throw shownError(t("checkout.error.zone"));
        case "address":
          throw shownError(t("checkout.error.address"));
        case "nothing_imported":
        case "empty_cart":
          throw shownError(t("error.nothingImported"));
        case "out_of_stock":
          throw shownError(t("checkout.error.outOfStock"));
        case "promo_invalid":
          throw shownError(t("checkout.error.promo"));
        case "promo_used":
          throw shownError(t("checkout.error.promoUsed"));
        case "gift_invalid":
          throw shownError(t("checkout.error.gift"));
        case "discount_fx":
          throw shownError(t("checkout.error.discountFx"));
        case "mixed_currency":
          throw shownError(t("checkout.error.mixedCurrency"));
        case "below_min":
          throw shownError(
            t("checkout.error.belowMin", {
              min: formatMoney(r.min, r.currency),
              short: formatMoney(r.shortfall, r.currency),
            }),
          );
        case "country_unavailable":
          throw shownError(t("checkout.error.country"));
        case "busy":
          throw shownError(t("error.tooManyRequests"));
        default:
          throw shownError(t("checkout.error.failed"));
      }
    }
    if (consent.offer || consent.privacy) {
      const { recordOrderEvent } = await import("@/core/orders/events");
      await recordOrderEvent(ctx, r.order.id, "consent", { ...consent }, "buyer").catch(() => {});
    }
    const { rememberFirstSource } = await import("@/core/storefront/web-order");
    await rememberFirstSource(ctx, customer, data.source);
    const { afterWebOrderPlaced } = await import("@/channels/web/order.server");
    await afterWebOrderPlaced(ctx, r.order, r.zeroTotal, r.amountDue);
    return { id: r.order.id, t: orderAccessToken(await secret(), ctx.tenant.id, r.order.id) };
  });

/**
 * Магазин, чья страница заказа открыта: клиент v2, не в архиве, с модулем
 * магазина. Оформление на сайте не требуется — по ссылке из выдачи в
 * Instagram/WhatsApp страницу открывают и покупатели магазина без сайта.
 */
async function orderPageCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  // Та же часть, что открывает шапку /s/<slug>: страница и её layout не расходятся.
  if (!t || !storefrontOpen(t, "order")) throw notFound();
  return tenantContext(t);
}

async function orderCtx(
  data: { slug: string; id: number; t: string },
  kind: "order" | "proof" | "card",
) {
  const ctx = kind === "order" ? await orderPageCtx(data.slug) : await checkoutCtx(data.slug);
  const { verifyOrderAccess } = await import("@/core/storefront/web-order");
  if (!verifyOrderAccess(await secret(), ctx.tenant.id, data.id, data.t)) throw notFound();
  const { takeWeb } = await import("@/core/storefront/checkout-guard");
  if (!(await takeWeb(ctx, kind, String(data.id))))
    throw shownError((await shopT(ctx))("error.tooManyRequests"));
  return ctx;
}

/** Страница заказа: статус, как платить, выданные материалы. */
export const webOrderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object(orderRef).parse(d))
  .handler(async ({ data }) => {
    const ctx = await orderCtx(data, "order");
    const { webOrderView } = await import("@/core/storefront/web-order");
    const view = await webOrderView(ctx, data.id);
    if (!view) throw notFound();
    return view;
  });

/**
 * «Повторить заказ» со страницы заказа: владение доказано подписанной ссылкой,
 * вход через Telegram не нужен. Состав берётся из самого заказа, цены — сегодняшние.
 */
export const webOrderReorderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object(orderRef).parse(d))
  .handler(async ({ data }) => {
    const ctx = await orderCtx(data, "order");
    const { getOrder } = await import("@/core/orders/orders");
    const { viewsOrderPage } = await import("@/core/storefront/web-order");
    const order = await getOrder(ctx, data.id);
    if (!order || !viewsOrderPage(order)) throw notFound();
    const { planReorder } = await import("@/core/storefront/reorder");
    return planReorder(ctx, order);
  });

/**
 * Чек с сайта. Тело запроса функции ограничено (~4,5 МБ на Vercel), поэтому
 * файл — до 3 МБ в base64: снимка экрана или PDF из банка хватает.
 */
export const WEB_PROOF_MAX_BYTES = 3 * 1024 * 1024;

export const webProofFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        ...orderRef,
        mime: z.string().max(100),
        data: z.string().max(Math.ceil((WEB_PROOF_MAX_BYTES * 4) / 3) + 8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await orderCtx(data, "proof");
    const t = await shopT(ctx);
    // Чек на странице — только у заказов, оплачиваемых на ней (сайт, счёт ссылкой).
    const { getOrder } = await import("@/core/orders/orders");
    const { hasOrderPage } = await import("@/core/storefront/web-order");
    const order = await getOrder(ctx, data.id);
    if (!order || !(await hasOrderPage(ctx, order))) throw notFound();
    const bytes = new Uint8Array(Buffer.from(data.data, "base64"));
    if (bytes.length === 0) throw shownError(t("checkout.proof.badFile"));
    if (bytes.length > WEB_PROOF_MAX_BYTES) throw shownError(t("checkout.proof.tooLarge"));
    const { receiveWebProof } = await import("@/channels/web/order.server");
    const r = await receiveWebProof(ctx, data.id, { bytes, mime: data.mime });
    if (!r.ok) {
      switch (r.reason) {
        case "duplicate":
          throw shownError(t("checkout.proof.duplicate"));
        case "closed":
        case "not_found":
          throw shownError(t("checkout.proof.closed"));
        case "invalid_file":
          throw shownError(t("checkout.proof.badFile"));
        case "file_too_large":
          throw shownError(t("checkout.proof.tooLarge"));
        default:
          throw shownError(t("checkout.error.failed"));
      }
    }
    return r;
  });

/** Оплата картой: ссылка Robokassa продавца на этот заказ. */
export const webCardPayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object(orderRef).parse(d))
  .handler(async ({ data }) => {
    const ctx = await orderCtx(data, "card");
    const { webCardPaymentUrl } = await import("@/core/storefront/web-order");
    const url = await webCardPaymentUrl(ctx, data.id);
    if (!url) throw shownError((await shopT(ctx))("checkout.proof.closed"));
    return { url };
  });

/** Оплата иностранной картой: сессия Stripe Checkout продавца на этот заказ. */
export const webStripePayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object(orderRef).parse(d))
  .handler(async ({ data }) => {
    const ctx = await orderCtx(data, "card");
    const { webStripePaymentUrl } = await import("@/core/storefront/web-order");
    const r = await webStripePaymentUrl(ctx, data.id);
    if (!r.ok)
      throw shownError(
        (await shopT(ctx))(
          r.reason === "closed" ? "checkout.proof.closed" : "order.payAbroadFailed",
        ),
      );
    return { url: r.url };
  });
