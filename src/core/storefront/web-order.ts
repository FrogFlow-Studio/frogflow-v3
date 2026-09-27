import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setEmail, upsertCustomer, type Customer } from "@/core/customers/customers";
import { clearCart, listCart } from "@/core/cart/cart";
import { getSetting } from "@/core/settings/settings";
import { importItems, type HandoffItem } from "./handoff";
import {
  parseWebCheckout,
  WEB_CHECKOUT_KEY,
  type WebCheckoutSettings,
} from "./web-checkout-settings";
import {
  deliverOrder,
  displayNo,
  getOrder,
  itemLanguages,
  itemMaterials,
  materialDownloadName,
  paymentMethodFor,
  placeOrder,
  signedFileUrl,
  type DeliverResult,
  type MaterialSender,
  type OrderWithItems,
  type PlaceOrderResult,
} from "@/core/orders/orders";
import { parseDeliveredLanguages } from "@/core/catalog/materials";
import { imageUrl } from "@/core/catalog/catalog";

/**
 * Заказ с витрины сайта без мессенджера. Покупатель — обычная строка
 * bot_users с каналом `web` (ключ — отпечаток почты: повторный заказ с той
 * же почтой попадает к тому же покупателю), заказ создаёт тот же placeOrder,
 * что и в боте: номер, склад, скидки, события. Чата нет, поэтому материалы
 * «выдаются» на страницу заказа (подписанная ссылка) и копией на почту;
 * письмо — не условие выдачи: без SMTP страница заказа работает.
 */
export { parseWebCheckout, WEB_CHECKOUT_KEY, type WebCheckoutSettings };

export async function webCheckoutSettings(ctx: TenantContext): Promise<WebCheckoutSettings> {
  return parseWebCheckout(await getSetting(ctx, WEB_CHECKOUT_KEY));
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** Отпечаток почты: адрес не светится в user_key и синтетическом telegram_id. */
export function webCustomerId(email: string): string {
  return createHash("sha256").update(`web:${email}`).digest("hex").slice(0, 32);
}

export async function webCustomer(
  ctx: TenantContext,
  input: { email: string; name: string; phone: string | null },
): Promise<Customer> {
  const c = await upsertCustomer(ctx, "web", webCustomerId(input.email), {
    firstName: input.name.slice(0, 64),
    contactPhone: input.phone,
  });
  return c.email === input.email ? c : setEmail(ctx, c, input.email);
}

/**
 * Подпись ссылки на страницу заказа. Номер заказа сквозной и угадывается,
 * поэтому без подписи чужой заказ не открыть; секрет — платформенный.
 */
export function orderAccessToken(secret: string, botId: string, orderId: number): string {
  return createHmac("sha256", secret)
    .update(`ff-web-order\0${botId}\0${orderId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyOrderAccess(
  secret: string,
  botId: string,
  orderId: number,
  token: string,
): boolean {
  if (!/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(orderAccessToken(secret, botId, orderId)), Buffer.from(token));
}

export type WebPlaceResult =
  PlaceOrderResult | { ok: false; reason: "physical_not_supported" | "nothing_imported" };

/**
 * Корзина с сайта → заказ. Корзина покупателя в базе сначала очищается:
 * на сайте он видит только то, что сейчас в браузере. Физические товары на
 * сайте пока не оформляются (способ получения, дата и адрес — следующий
 * шаг), для них остаётся бот.
 */
export async function placeWebOrder(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
  countryCode: string,
): Promise<WebPlaceResult> {
  await clearCart(ctx, customer);
  if ((await importItems(ctx, customer, items)) === 0)
    return { ok: false, reason: "nothing_imported" };
  const cart = await listCart(ctx, customer);
  if (cart.some((it) => it.products?.fulfillment_kind === "physical")) {
    await clearCart(ctx, customer);
    return { ok: false, reason: "physical_not_supported" };
  }
  return placeOrder(ctx, customer, countryCode);
}

/** «Отправка» материалов покупателю с сайта: они уже на странице заказа. */
export const webMaterialSender: MaterialSender = async () => "sent";

export function deliverWebOrder(
  ctx: TenantContext,
  orderId: number,
  actor?: string,
): Promise<DeliverResult> {
  // Спросить язык негде — при нескольких языках отдаём все.
  return deliverOrder(ctx, orderId, webMaterialSender, {
    lang: ctx.tenant.settings.default_locale ?? "ru",
    allWhenAmbiguous: true,
    ...(actor ? { actor } : {}),
  });
}

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
  }
  return out;
}

export type WebOrderView = {
  id: number;
  no: number;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  items: Array<{ name: string; qty: number; price: number }>;
  /** Как платить: реквизиты и QR способа оплаты страны заказа; null — платить не нужно. */
  payment: { instructions: string | null; qr: string | null } | null;
  materials: WebMaterial[];
  email: string | null;
};

const PAYABLE = new Set(["awaiting_payment"]);

export async function webOrderView(
  ctx: TenantContext,
  orderId: number,
): Promise<WebOrderView | null> {
  const order = await getOrder(ctx, orderId);
  if (!order || order.platform !== "web") return null;
  const method =
    PAYABLE.has(order.status) && order.country_code
      ? await paymentMethodFor(ctx, order.country_code)
      : null;
  return {
    id: order.id,
    no: displayNo(order),
    status: order.status,
    total: Number(order.total),
    currency: order.currency,
    createdAt: order.created_at,
    items: (order.order_items ?? []).map((i) => ({
      name: i.name_snapshot,
      qty: Number(i.quantity),
      price: Number(i.price_snapshot),
    })),
    payment: method
      ? {
          instructions: method.instructions ?? null,
          qr: method.qr_code_path ? imageUrl(ctx, method.qr_code_path) : null,
        }
      : null,
    materials: await webOrderMaterials(ctx, order),
    email: order.customer_email,
  };
}
