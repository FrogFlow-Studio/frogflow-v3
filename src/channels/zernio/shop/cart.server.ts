import { recordEngage } from "@/core/automsg/engage";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { type Customer } from "@/core/customers/customers";
import { type Locale } from "@/core/i18n/locale";
import { addToCart, listCart, priceCart, removeCartItem } from "@/core/cart/cart";
import { formatMoney } from "@/core/money/money";
import { resolvePrice } from "@/core/pricing/pricing";
import { cartSummary } from "@/core/orders/orders";
import { REPLY_WINDOW_MS } from "@/core/chat/reply-window";
import { belowMinimum } from "@/core/cart/min-order";
import { freeDeliveryView } from "@/core/fulfillment/free-delivery-cart";
import { freeDeliveryText, minOrderText } from "@/channels/telegram/copy";
import { pickCartLineToRemove, plain, cartCardText } from "../shop-flow";
import { BTN, type Shop, reply } from "./context.server";

// ── корзина ───────────────────────────────────────────────────────────

export async function addAndShowCart(
  s: Shop,
  productId: string,
  variantId: string | null,
  fromUpsell = false,
) {
  const r = await addToCart(s.ctx, s.customer, productId, variantId);
  if (r === "ok" && fromUpsell) await recordEngage(s.ctx, "upsell_add", s.customer.telegramId);
  const msg: Record<typeof r, string> = {
    ok: s.m.added,
    unavailable: s.m.unavailable,
    mixed_cart: s.m.mixedCart,
    digital_limit: s.m.digitalLimit,
    out_of_stock: s.m.outOfStock,
    error: s.m.unavailable,
  };
  if (r !== "ok") {
    await reply(s, msg[r], { force: true, buttons: [BTN.cart(s.m), BTN.catalog(s.m)] });
    return;
  }
  await showCart(s, true, plain(s.m.added));
}

/**
 * Сводка корзины одной строкой — та же цена, что в оформлении (`cartSummary`:
 * скидки, баллы, сертификат). null — корзина пуста. Событие старше окна ответа
 * (повторная доставка вебхука) не отвечаем: сообщение всё равно не дойдёт.
 */
export async function cartCard(
  ctx: TenantContext,
  customer: Customer,
  locale: Locale,
  inboundAt: number | null = null,
): Promise<string | null> {
  if (inboundAt !== null && Date.now() - inboundAt > REPLY_WINDOW_MS) return null;
  const items = await listCart(ctx, customer);
  if (items.length === 0) return null;
  const st = customer.state;
  const priced = await priceCart(ctx, items, st.country_code ?? null);
  const sum = await cartSummary(ctx, customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  const count = items.reduce((n, i) => n + Number(i.quantity), 0);
  return cartCardText(locale, count, formatMoney(sum.total, sum.currency));
}

export async function showCart(s: Shop, force: boolean, prefix?: string) {
  const items = await listCart(s.ctx, s.customer);
  if (items.length === 0) {
    await reply(s, s.m.cartEmpty, { force, buttons: [BTN.catalog(s.m)] });
    return;
  }
  const st = s.customer.state;
  const priced = await priceCart(s.ctx, items, st.country_code ?? null);
  const sum = await cartSummary(s.ctx, s.customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  let text = `${prefix ? `${prefix}\n\n` : ""}${plain(s.m.cartHeader)}`;
  const { preordersFor, activePreorder } = await import("@/core/preorder/preorder");
  const preorders = await preordersFor(
    s.ctx,
    priced.lines.map((l) => l.item.products!.id),
  );
  priced.lines.forEach((line, i) => {
    text += `${i + 1}. ${line.name} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
    const pre = activePreorder(
      s.ctx,
      line.item.products!,
      preorders.get(line.item.products!.id),
      Number(line.item.quantity),
    );
    if (pre) text += plain(s.m.preorderCartNote(pre.from));
  });
  if (sum.promo) text += plain(s.m.discountLine(formatMoney(sum.promo.discount, sum.currency)));
  if (sum.points.balance > 0) text += plain(s.m.pointsBalanceLine(sum.points.balance));
  if (sum.points.discount > 0) {
    const pts = formatMoney(sum.points.discount, sum.currency);
    text += plain(s.m.pointsDiscountLine(pts));
    if (sum.points.fx) text += plain(s.m.pointsFxLine(sum.points.spent, pts));
  }
  if (sum.gift)
    text += plain(s.m.giftCertificateDiscountLine(formatMoney(sum.gift.discount, sum.currency)));
  text += plain(s.m.total(formatMoney(sum.total, sum.currency)));
  const below = await belowMinimum(s.ctx, priced);
  if (below) text += plain(`${minOrderText(s.m, below)}\n`);
  const freeStatus = await (await freeDeliveryView(s.ctx, s.customer))?.forZone(null);
  if (freeStatus) text += plain(freeDeliveryText(s.m, freeStatus));
  if (s.locale === "ru") text += "\n\nУбрать позицию: «убрать 1».";
  await reply(s, text, { force, buttons: [BTN.checkout(s.m), BTN.catalog(s.m), BTN.clear(s.m)] });
  if (s.ctx.tenant.modules.upsell) {
    const { upsellFor } = await import("@/core/upsell/upsell");
    const offers = await upsellFor(
      s.ctx,
      priced.lines.map((l) => l.item.products?.id).filter((x): x is string => Boolean(x)),
    );
    if (offers.length) {
      const lines: string[] = [];
      for (const o of offers) {
        const money = await resolvePrice(s.ctx, o, st.country_code ?? null);
        lines.push(`• ${o.name} — ${formatMoney(money.amount, money.currency)}`);
      }
      await reply(s, `${plain(s.m.upsellHeader)}\n${lines.join("\n")}`, {
        force: true,
        buttons: offers.map((o) => ({
          type: "postback" as const,
          title: `➕ ${o.name}`.slice(0, 20),
          payload: `BUY:${o.id}::u`,
        })),
      });
    }
  }
}

export async function removeFromCart(s: Shop, number: string) {
  const items = await listCart(s.ctx, s.customer);
  const idx = pickCartLineToRemove(
    number,
    items.map((i) => i.products?.name ?? ""),
  );
  if (idx === null) {
    await showCart(s, true);
    return;
  }
  await removeCartItem(s.ctx, s.customer, items[idx]!.id);
  await showCart(s, true);
}
