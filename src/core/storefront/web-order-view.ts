import type { TenantContext } from "@/core/tenant/resolve.server";
import { storefrontOpen } from "./access";
import {
  displayNo,
  getOrder,
  itemLanguages,
  itemMaterials,
  materialDownloadName,
  paymentMethodFor,
  signedFileUrl,
  type OrderWithItems,
} from "@/core/orders/orders";
import { parseDeliveredLanguages } from "@/core/catalog/materials";
import { imageUrl } from "@/core/catalog/catalog";
import { prodamusFor, robokassaFor, stripeFor } from "@/core/payments/payment";
import { prodamusCharge } from "@/core/payments/prodamus";
import { amountDueNow } from "@/core/fulfillment/fulfillment";
import { orderAccessToken } from "./web-order-access";

/** Страница заказа на сайте: материалы, суммы, доставка, подарок. */

export type WebMaterial = { item: string; name: string; url: string; lang: string };

/** Ссылки на выданные файлы заказа (с водяным знаком, если он включён), на сутки. */
export async function webOrderMaterials(
  ctx: TenantContext,
  order: OrderWithItems,
): Promise<WebMaterial[]> {
  if (order.status !== "delivered" || order.fulfillment_kind === "physical") return [];
  const { protectMaterials } = await import("@/core/delivery/watermark.server");
  const out: WebMaterial[] = [];
  for (const item of order.order_items ?? []) {
    const got = parseDeliveredLanguages(item.delivered_language);
    const langs = itemLanguages(item).filter((l) => got.size === 0 || got.has(l));
    for (const l of langs) {
      const list = await protectMaterials(ctx, order, itemMaterials(item, l));
      for (const mat of list) {
        const url =
          mat.url ??
          (mat.path
            ? await signedFileUrl(
                mat.path,
                24 * 3600,
                materialDownloadName(mat, item.name_snapshot, list),
              )
            : null);
        if (url)
          out.push({
            item: item.name_snapshot,
            name: mat.name ?? item.name_snapshot,
            url,
            lang: l,
          });
      }
    }
    // Курс (модуль «Курсы»): ссылка на уроки — как в сообщении о выдаче.
    if (ctx.tenant.modules.courses) {
      const { courseMaterials } = await import("@/core/courses/delivery.server");
      for (const c of await courseMaterials(ctx, item))
        if (c.url)
          out.push({
            item: item.name_snapshot,
            name: c.name ?? item.name_snapshot,
            url: c.url,
            lang: "",
          });
    }
  }
  return out;
}

export type WebOrderView = {
  id: number;
  no: number;
  status: string;
  total: number;
  /** Сколько платить сейчас: задаток у физического заказа, иначе вся сумма. */
  due: number;
  currency: string;
  createdAt: string;
  /** Физический заказ: как и когда получить. */
  fulfillment: {
    type: "pickup" | "delivery" | null;
    date: string | null;
    address: string | null;
    zone: string | null;
    fee: number;
  } | null;
  items: Array<{ name: string; qty: number; price: number }>;
  /**
   * Часть заказа взята предзаказом (core/preorder): остаток не списан, отправка
   * не раньше `from` (самая поздняя из названных дат; null — срок не назван).
   */
  preorder: { from: string | null } | null;
  /** Скидка промокодом, баллами и сертификатом вместе; total — уже после неё. */
  discount: number;
  /**
   * Как платить: реквизиты и QR способа оплаты страны заказа, карта через
   * Robokassa продавца, иностранная карта через Stripe (abroad) и/или карта
   * РФ и СБП через Продамус (russia); null — платить не нужно.
   */
  payment: {
    instructions: string | null;
    qr: string | null;
    card: boolean;
    abroad: boolean;
    /** Сколько спишет Продамус (заказ в тенге — рубли по курсу продавца); null — нет. */
    russia: { amount: number; currency: string } | null;
  } | null;
  materials: WebMaterial[];
  email: string | null;
  /** Чек загружен — заказ на проверке у продавца по чеку, а не по контактам. */
  proof: boolean;
  /**
   * Остаток по задатку (core/orders/balance): задаток внесён, заказ в работе,
   * покупатель может доплатить сам. null — доплачивать нечего или нечем.
   */
  balance: {
    due: number;
    paid: number;
    instructions: string | null;
    qr: string | null;
    card: boolean;
  } | null;
  /** Чек на остаток прислан и ждёт продавца. */
  balancePending: boolean;
  /** Заказ у курьера (модуль courier): служба и ссылка на отслеживание. */
  courier: { provider: string; trackUrl: string | null } | null;
  /** Посылка отправлена с трек-номером (Б12): номер и ссылка отслеживания, если формат известен. */
  tracking: { number: string | null; url: string | null } | null;
  /** Покупка подарочного сертификата: номинал, а код — только после выдачи. */
  gift: { amount: number; currency: string; code: string | null } | null;
  /** Остаток сертификата, применённого к заказу, — новым кодом (core/discounts/gift-rest). */
  giftRest: { code: string; amount: number; currency: string } | null;
};

export const PAYABLE = new Set(["awaiting_payment"]);

/**
 * Чьи заказы открываются страницей заказа на сайте (по подписанной ссылке):
 * заказы с сайта и счета ссылкой из диалога Instagram/WhatsApp
 * (core/orders/invoice-link). Остальные заказы каналов оплачиваются там.
 */
export async function hasOrderPage(
  ctx: TenantContext,
  order: { id: number; platform: string | null },
): Promise<boolean> {
  if (order.platform === "web") return true;
  if (order.platform !== "instagram" && order.platform !== "whatsapp") return false;
  const { isInvoiceLink } = await import("@/core/orders/invoice-link");
  return isInvoiceLink(ctx, order.id);
}

/**
 * Страница заказа по подписанной ссылке открывается у любого заказа магазина — с
 * сайта, из Telegram, Instagram/WhatsApp и созданного вручную: это «где мой заказ»
 * (статус, шаги, трек, чек, «написать магазину»). Оплата на странице — только
 * там, где hasOrderPage.
 *
 * Подписанная ссылка на страницу заказа (как в письме и на сайте). Нет
 * адреса магазина (settings.slug) — null: страницы у такого магазина нет.
 */
export async function orderPageUrl(ctx: TenantContext, orderId: number): Promise<string | null> {
  const slug = ctx.tenant.settings.slug;
  // Ссылка только туда, где страница откроется (как orderPageCtx и шапка /s/<slug>).
  if (!slug || !storefrontOpen(ctx.tenant, "order")) return null;
  const { env } = await import("@/config/env");
  const t = orderAccessToken(env().SESSION_SECRET, ctx.tenant.id, orderId);
  return `${ctx.appUrl}/s/${encodeURIComponent(slug)}/order/${orderId}?t=${t}`;
}

/**
 * Скидка заказа в его валюте: позиции и доставка минус итог. Сложить поля
 * нельзя: points_used — это баллы (1 балл = 1 ₸), а заказ бывает в рублях
 * или долларах, и 5 000 баллов показались бы скидкой в 5 000 $.
 */
export function orderDiscount(order: {
  total: number | string;
  delivery_fee?: number | string | null;
  order_items?: Array<{ price_snapshot: number | string; quantity: number | string }> | null;
}): number {
  const items = (order.order_items ?? []).reduce(
    (sum, i) => sum + (Number(i.price_snapshot) || 0) * (Number(i.quantity) || 0),
    0,
  );
  const gross = items + (Number(order.delivery_fee) || 0);
  return Math.max(0, Math.round((gross - (Number(order.total) || 0)) * 100) / 100);
}

/**
 * Предзаказ по заказу — по событию `order.preorder`. Это подсказка на странице:
 * не прочиталось — страница открывается без неё (деньги и выдачу событие не решает).
 */
async function webOrderPreorder(
  ctx: TenantContext,
  orderId: number,
): Promise<WebOrderView["preorder"]> {
  if (!ctx.tenant.modules.stock) return null;
  try {
    const { preorderLinesOfOrder } = await import("@/core/preorder/preorder");
    const lines = await preorderLinesOfOrder(ctx, orderId);
    if (lines.length === 0) return null;
    const dates = lines.flatMap((l) => (l.from ? [l.from] : [])).sort();
    return { from: dates.at(-1) ?? null };
  } catch (e) {
    console.error(`[web-order] предзаказ заказа #${orderId} не прочитан: ${String(e)}`);
    return null;
  }
}

/**
 * Страница заказа открывается по ссылке, а ссылку покупатель пересылает и сохраняет где
 * попало, поэтому полных контактов в ней нет: почта показана по краям («a***@m***.ru»),
 * адрес доставки — только до первой запятой. Телефона в виде заказа нет совсем.
 */
export function maskEmail(raw: string | null): string | null {
  if (!raw) return null;
  const [local = "", domain = ""] = raw.trim().split("@");
  if (!local || !domain) return null;
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const zone = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${zone}`;
}

export function maskAddress(raw: string | null): string | null {
  const a = raw?.trim();
  if (!a) return null;
  const head = (a.split(",")[0] ?? "").trim();
  const first = head.replace(/\d.*$/, "").trim().slice(0, 40);
  return first ? `${first}, …` : "…";
}

export async function webOrderView(
  ctx: TenantContext,
  orderId: number,
): Promise<WebOrderView | null> {
  const order = await getOrder(ctx, orderId);
  if (!order) return null;
  const payable = PAYABLE.has(order.status) && (await hasOrderPage(ctx, order));
  const method =
    payable && order.country_code ? await paymentMethodFor(ctx, order.country_code) : null;
  const card = payable && (await robokassaFor(ctx, order.currency)).ready;
  const abroad = payable && (await stripeFor(ctx)).ready;
  const prodamus = payable ? await prodamusFor(ctx, order.currency) : null;
  const { balance, balancePending } = await balanceView(ctx, order);
  const due = payable
    ? await amountDueNow(ctx, {
        total: Number(order.total),
        fulfillment_kind: order.fulfillment_kind,
      })
    : 0;
  return {
    id: order.id,
    no: displayNo(order),
    status: order.status,
    total: Number(order.total),
    due,
    currency: order.currency,
    createdAt: order.created_at,
    fulfillment:
      order.fulfillment_kind === "physical"
        ? {
            type:
              order.fulfillment_type === "pickup" || order.fulfillment_type === "delivery"
                ? order.fulfillment_type
                : null,
            date: order.fulfillment_at ? String(order.fulfillment_at).slice(0, 10) : null,
            address: maskAddress(order.fulfillment_address),
            zone: order.delivery_zone_name,
            fee: Number(order.delivery_fee) || 0,
          }
        : null,
    items: (order.order_items ?? []).map((i) => ({
      name: i.name_snapshot,
      qty: Number(i.quantity),
      price: Number(i.price_snapshot),
    })),
    preorder: await webOrderPreorder(ctx, order.id),
    discount: orderDiscount(order),
    payment:
      method || card || abroad || prodamus?.ready
        ? {
            instructions: method?.instructions ?? null,
            qr: method?.qr_code_path ? imageUrl(ctx, method.qr_code_path) : null,
            card,
            abroad,
            russia: prodamus?.ready ? prodamusCharge(prodamus, due, order.currency) : null,
          }
        : null,
    materials: await webOrderMaterials(ctx, order),
    email: maskEmail(order.customer_email),
    proof: Boolean(order.payment_proof_path),
    balance,
    balancePending,
    gift: await webOrderGift(ctx, order),
    courier: await webOrderCourier(ctx, order),
    tracking: await webOrderTracking(ctx, order),
    giftRest: order.gift_certificate_code
      ? await (
          await import("@/core/discounts/gift-rest")
        )
          .giftRestOf(ctx, order.id)
          .catch(() => null)
      : null,
  };
}

async function balanceView(
  ctx: TenantContext,
  order: OrderWithItems,
): Promise<Pick<WebOrderView, "balance" | "balancePending">> {
  const { balanceDue, balanceProofPending } = await import("@/core/orders/balance");
  const due = balanceDue(order);
  if (!due) return { balance: null, balancePending: false };
  if (await balanceProofPending(ctx, order.id, order.paid_amount))
    return { balance: null, balancePending: true };
  const [method, rk] = await Promise.all([
    order.country_code ? paymentMethodFor(ctx, order.country_code) : null,
    robokassaFor(ctx, order.currency),
  ]);
  if (!method && !rk.ready) return { balance: null, balancePending: false };
  return {
    balance: {
      due,
      paid: Number(order.paid_amount) || 0,
      instructions: method?.instructions ?? null,
      qr: method?.qr_code_path ? imageUrl(ctx, method.qr_code_path) : null,
      card: rk.ready,
    },
    balancePending: false,
  };
}

async function webOrderCourier(
  ctx: TenantContext,
  order: OrderWithItems,
): Promise<WebOrderView["courier"]> {
  if (order.fulfillment_kind !== "physical") return null;
  if (!["accepted", "in_production", "ready", "delivered"].includes(order.status)) return null;
  const [{ listOrderEvents }, { courierState }] = await Promise.all([
    import("@/core/orders/events"),
    import("@/core/fulfillment/courier"),
  ]);
  const c = courierState(await listOrderEvents(ctx, order.id));
  return c ? { provider: c.provider, trackUrl: c.trackUrl } : null;
}

async function webOrderTracking(
  ctx: TenantContext,
  order: OrderWithItems,
): Promise<WebOrderView["tracking"]> {
  if (order.fulfillment_kind !== "physical" || order.status !== "delivered") return null;
  const [{ listOrderEvents }, { latestTracking }] = await Promise.all([
    import("@/core/orders/events"),
    import("@/core/orders/tracking"),
  ]);
  const t = latestTracking(await listOrderEvents(ctx, order.id));
  return t ? { number: t.number, url: t.url } : null;
}

async function webOrderGift(
  ctx: TenantContext,
  order: OrderWithItems,
): Promise<WebOrderView["gift"]> {
  const items = order.order_items ?? [];
  if (items.length === 0 || items.some((i) => i.product_id)) return null;
  const { giftSaleOf } = await import("@/core/discounts/gift-sale");
  const sale = await giftSaleOf(ctx, order.id);
  if (!sale) return null;
  return {
    amount: sale.amount,
    currency: sale.currency,
    code: order.status === "delivered" ? (sale.code ?? null) : null,
  };
}
