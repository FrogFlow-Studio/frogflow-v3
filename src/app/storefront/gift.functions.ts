import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import type { Locale } from "@/core/i18n/locale";

/**
 * Покупка подарочного сертификата на витрине сайта (core/storefront/gift-order).
 * Те же ворота, что у оформления на сайте: модуль витрины, клиент v2,
 * оформление на сайте включено; сверху — продажа сертификатов включена
 * продавцом. Против ботов — та же задача для браузера и те же лимиты.
 * Страница заказа, оплата и чек — общие с обычным заказом (checkout.functions).
 */
const slug = z.string().regex(SHOP_SLUG_RE);

async function shopT(ctx: { tenant: { settings: { default_locale?: Locale } } }) {
  const { storefrontT } = await import("@/app/i18n/storefront");
  return storefrontT(ctx.tenant.settings.default_locale ?? "ru");
}

async function secret() {
  const { env } = await import("@/config/env");
  return env().SESSION_SECRET;
}

async function giftCtx(s: string) {
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { storefrontOpen } = await import("@/core/storefront/access");
  const t = await resolveTenant({ by: "slug", value: s });
  if (!t || !storefrontOpen(t, "web_checkout")) throw notFound();
  const ctx = tenantContext(t);
  const { giftSaleOpen } = await import("@/core/discounts/gift-sale");
  const { webCheckoutSettings } = await import("@/core/storefront/web-order");
  if (!giftSaleOpen(ctx) || !(await webCheckoutSettings(ctx)).enabled) throw notFound();
  return ctx;
}

/** Номиналы, страны оплаты в валюте сертификата и свежая задача для браузера. */
export const giftSaleInfoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    let ctx;
    try {
      ctx = await giftCtx(data.slug);
    } catch {
      return { open: false as const };
    }
    const { giftSaleSettings } = await import("@/core/discounts/gift-sale");
    const { giftSaleCountries } = await import("@/core/storefront/gift-order");
    const countries = await giftSaleCountries(ctx);
    if (countries.length === 0) return { open: false as const };
    const { amounts, currency } = giftSaleSettings(ctx);
    const { issueChallenge } = await import("@/app/signup/challenge");
    return {
      open: true as const,
      amounts,
      currency,
      countries,
      challenge: issueChallenge(await secret(), Date.now(), "checkout"),
    };
  });

const giftInput = z.object({
  slug,
  amount: z.number().int().positive(),
  name: z.string().trim().min(1).max(64),
  email: z.string().max(254),
  phone: z.string().max(32).optional(),
  country: z.string().regex(/^[A-Z]{2}$/),
  /** Приманка для ботов: поле скрыто, человек его не заполняет. */
  website: z.string().max(0).optional(),
  challenge: z.string().max(200),
  answer: z.string().max(20),
});

export const giftCheckoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => giftInput.parse(d))
  .handler(async ({ data }) => {
    const ctx = await giftCtx(data.slug);
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
    const { clientIp } = await import("@/app/auth/login-guard.server");
    const { claimCheckoutChallenge, takeWeb } = await import("@/core/storefront/checkout-guard");
    if (
      !(await takeWeb(ctx, "checkoutIp", clientIp() ?? "unknown")) ||
      !(await takeWeb(ctx, "checkoutEmail", email))
    )
      throw shownError(t("error.tooManyRequests"));
    const claimed = await claimCheckoutChallenge(ctx, challengeNonce(data.challenge)!);
    if (claimed === "used") throw shownError(t("checkout.error.refresh"));
    if (claimed === "failed") throw shownError(t("checkout.error.failed"));

    const { normalizePhone } = await import("@/channels/telegram/copy");
    const { webCustomer, orderAccessToken } = await import("@/core/storefront/web-order");
    const { placeGiftOrder } = await import("@/core/storefront/gift-order");
    const phone = data.phone?.trim() ? normalizePhone(data.phone) : null;
    const customer = await webCustomer(ctx, { email, name: data.name, phone });
    const r = await placeGiftOrder(ctx, customer, data.amount, data.country, {
      name: data.name,
      phone,
    });
    if (!r.ok) {
      switch (r.reason) {
        case "amount":
          throw shownError(t("gift.error.amount"));
        case "country_unavailable":
          throw shownError(t("checkout.error.country"));
        case "busy":
          throw shownError(t("error.tooManyRequests"));
        case "closed":
          throw notFound();
        default:
          throw shownError(t("checkout.error.failed"));
      }
    }
    return { id: r.order.id, t: orderAccessToken(await secret(), ctx.tenant.id, r.order.id) };
  });
