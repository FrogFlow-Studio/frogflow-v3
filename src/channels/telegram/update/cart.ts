// Корзина.
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import type { InlineButton } from "../types";
import { COPY, escapeHtml, freeDeliveryText, minOrderText } from "../copy";
import { formatMoney } from "@/core/money/money";
import type { Customer } from "@/core/customers/customers";
import { resolvePrice } from "@/core/pricing/pricing";
import { listCart, priceCart } from "@/core/cart/cart";
import { belowMinimum } from "@/core/cart/min-order";
import { freeDeliveryView } from "@/core/fulfillment/free-delivery-cart";
import { cartSummary } from "@/core/orders/orders";
import { shopCurrency } from "@/core/discounts/discounts";
import { customerTierStatus } from "@/core/loyalty/tiers";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import { type Bot, localeOf, send } from "./bot";

/** Показать корзину покупателю извне (Mini App перенёс позиции). */
export async function sendCartMessage(
  ctx: TenantContext,
  api: TelegramApi,
  customer: Customer,
): Promise<void> {
  const locale = localeOf(ctx, customer);
  const sells = await sellsNowOrShop(ctx);
  await showCart({
    ctx,
    api,
    chatId: customer.telegramId,
    customer,
    locale,
    m: COPY[locale],
    sells,
  });
}

// ── корзина и оформление ──────────────────────────────────────────────

/** Уровень лояльности и «до следующего»; сбой чтения — без строки, а не без корзины. */
async function tierLine(b: Bot): Promise<string> {
  try {
    const cur = await shopCurrency(b.ctx);
    const status = await customerTierStatus(b.ctx, b.customer.telegramId, cur);
    if (!status?.tier) return "";
    const toNext = status.next
      ? b.m.loyaltyTierNext(
          formatMoney(status.next.remaining, cur),
          escapeHtml(status.next.tier.name),
        )
      : null;
    return b.m.loyaltyTierLine(escapeHtml(status.tier.name), status.tier.percent, toNext);
  } catch (e) {
    console.error(`[telegram] уровень лояльности: ${String(e)}`);
    return "";
  }
}

export async function showCart(b: Bot) {
  const items = await listCart(b.ctx, b.customer);
  if (items.length === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  const st = b.customer.state;
  const priced = await priceCart(b.ctx, items, st.country_code ?? null);
  const sum = await cartSummary(b.ctx, b.customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  const mod = b.ctx.tenant.modules;
  let text = b.m.cartHeader;
  const buttons: InlineButton[][] = [];
  const { preordersFor, activePreorder } = await import("@/core/preorder/preorder");
  const preorders = await preordersFor(
    b.ctx,
    priced.lines.map((l) => l.item.products!.id),
  );
  for (const line of priced.lines) {
    text += `• ${escapeHtml(line.name)} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
    const pre = activePreorder(
      b.ctx,
      line.item.products!,
      preorders.get(line.item.products!.id),
      Number(line.item.quantity),
    );
    if (pre) text += b.m.preorderCartNote(pre.from);
    buttons.push([{ text: b.m.removeItem(line.name), callback_data: `rem:${line.item.id}` }]);
  }
  if (sum.promo) text += b.m.discountLine(formatMoney(sum.promo.discount, sum.currency));
  if (sum.points.balance > 0) {
    text += b.m.pointsBalanceLine(sum.points.balance);
    if (sum.points.discount > 0)
      text += b.m.pointsDiscountLine(formatMoney(sum.points.discount, sum.currency));
    if (sum.points.fx)
      text += b.m.pointsFxLine(sum.points.spent, formatMoney(sum.points.discount, sum.currency));
  }
  if (mod.loyalty) text += await tierLine(b);
  if (sum.gift)
    text += b.m.giftCertificateDiscountLine(formatMoney(sum.gift.discount, sum.currency));
  if (sum.discountFx) text += `${b.m.discountFx}\n`;
  if (mod.bundles && st.gift_on)
    text += b.m.giftCartLine(
      escapeHtml(st.gift_recipient ?? ""),
      escapeHtml(st.gift_message ?? ""),
    );
  const { giftWrapForCart } = await import("@/core/orders/gift-wrap");
  const { giftAskOn } = await import("@/core/orders/gift");
  const wrapFee =
    mod.bundles && st.gift_on
      ? await giftWrapForCart(b.ctx, { kind: priced.kind, currency: sum.currency })
      : 0;
  if (wrapFee > 0 && st.gift_wrap) text += b.m.giftWrapLine(formatMoney(wrapFee, sum.currency));
  text += b.m.total(
    formatMoney(sum.total + (wrapFee > 0 && st.gift_wrap ? wrapFee : 0), sum.currency),
  );
  const below = await belowMinimum(b.ctx, priced);
  if (below) text += `${minOrderText(b.m, below)}\n`;
  const freeStatus = await (await freeDeliveryView(b.ctx, b.customer))?.forZone(null);
  if (freeStatus) text += freeDeliveryText(b.m, freeStatus);
  buttons.push([
    { text: b.m.checkoutBtn, callback_data: "checkout" },
    { text: b.m.clearBtn, callback_data: "clear" },
  ]);
  if (mod.coupons) {
    buttons.push([
      sum.promo
        ? { text: b.m.removePromoBtn, callback_data: "promo:clear" }
        : { text: b.m.promoCodeBtn, callback_data: "promo:enter" },
    ]);
  }
  if (mod.loyalty && sum.points.balance > 0) {
    buttons.push([
      sum.points.used
        ? { text: b.m.removePointsBtn, callback_data: "points:clear" }
        : { text: b.m.usePointsBtn, callback_data: "points:use" },
    ]);
  }
  if (mod.gift_certificates) {
    buttons.push([
      sum.gift
        ? { text: b.m.removeGiftCertificateBtn, callback_data: "giftcert:clear" }
        : { text: b.m.giftCertificateBtn, callback_data: "giftcert:enter" },
    ]);
  }
  // Кнопка подарка — только если продавец включил «Предлагать оформить заказ подарком».
  if (mod.bundles && (await giftAskOn(b.ctx))) {
    buttons.push([
      st.gift_on
        ? { text: b.m.removeGiftBtn, callback_data: "gift:clear" }
        : { text: b.m.giftBtn, callback_data: "gift:enter" },
    ]);
  }
  if (wrapFee > 0) {
    buttons.push([
      st.gift_wrap
        ? { text: b.m.removeGiftWrapBtn, callback_data: "gift:unwrap" }
        : { text: b.m.giftWrapBtn(formatMoney(wrapFee, sum.currency)), callback_data: "gift:wrap" },
    ]);
  }
  if (mod.upsell) {
    const { upsellFor } = await import("@/core/upsell/upsell");
    const offers = await upsellFor(
      b.ctx,
      priced.lines.map((l) => l.item.products?.id).filter((x): x is string => Boolean(x)),
    );
    if (offers.length) {
      text += `\n\n${b.m.upsellHeader}`;
      for (const o of offers) {
        const money = await resolvePrice(b.ctx, o, st.country_code ?? null);
        buttons.push([
          {
            text: `➕ ${o.name} — ${formatMoney(money.amount, money.currency)}`.slice(0, 64),
            // Третья часть «u» — кнопка из «С этим берут»: добавление идёт в итоги допродажи.
            callback_data: `add:${o.id}::u`,
          },
        ]);
      }
    }
  }
  await send(b, text.slice(0, 4096), { reply_markup: { inline_keyboard: buttons } });
}
