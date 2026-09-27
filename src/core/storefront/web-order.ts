import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  getCustomer,
  setEmail,
  setState,
  upsertCustomer,
  userKey,
  type Customer,
} from "@/core/customers/customers";
import { isWebSource } from "./web-source";
import { clearCart, listCart } from "@/core/cart/cart";
import { getSetting } from "@/core/settings/settings";
import { importItems, type HandoffItem } from "./handoff";
import {
  resolveWebFulfillment,
  type WebFulfillmentCheck,
  type WebFulfillmentRequest,
} from "./web-fulfillment";
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
import { robokassaFor } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { amountDueNow } from "@/core/fulfillment/fulfillment";

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

/**
 * Покупатель сайта по почте. Почту никто не подтверждает, поэтому имя и
 * телефон существующего покупателя не перезаписываются: иначе любой, введя
 * чужую почту, подменил бы продавцу контакты. Контакты этого оформления
 * ложатся в сам заказ (placeWebOrder).
 */
export async function webCustomer(
  ctx: TenantContext,
  input: { email: string; name: string; phone: string | null },
): Promise<Customer> {
  const id = webCustomerId(input.email);
  const existing = await getCustomer(ctx, `web_${id}`);
  const c =
    existing ??
    (await upsertCustomer(ctx, "web", id, {
      firstName: input.name.slice(0, 64),
      contactPhone: input.phone,
    }));
  return c.email === input.email ? c : setEmail(ctx, c, input.email);
}

/**
 * Покупатель вошёл на витрину через Telegram: заказ с сайта ложится на того
 * же покупателя, что и в боте (telegram_id и user_key из бота), поэтому в
 * карточке продавца и в «Моих заказах» заказы бота и сайта вместе. Канал
 * заказа остаётся `web`: страница заказа, оплата, письмо и срок неоплаченного
 * работают как у любого заказа с сайта. Почта — его собственная: он вошёл.
 * Нет такого покупателя в боте — null, оформление идёт по почте.
 */
export async function telegramWebCustomer(
  ctx: TenantContext,
  telegramId: number,
  email: string,
): Promise<Customer | null> {
  const c = await getCustomer(ctx, userKey("telegram", telegramId));
  if (!c || c.platform !== "telegram" || c.telegramId !== telegramId) return null;
  const withEmail = c.email === email ? c : await setEmail(ctx, c, email);
  return { ...withEmail, platform: "web" };
}

/**
 * Первый источник покупателя с сайта (utm, ref) — в state.first_source, как
 * у бота, и только если источника ещё нет: первая ссылка не перезаписывается.
 * Пишется после оформленного заказа; сбой записи заказ не срывает.
 */
export async function rememberFirstSource(
  ctx: TenantContext,
  customer: Customer,
  source: unknown,
): Promise<void> {
  if (!isWebSource(source)) return;
  const fresh = (await getCustomer(ctx, customer.userKey)) ?? customer;
  if (fresh.state.first_source) return;
  try {
    await setState(ctx, fresh, { ...fresh.state, first_source: source });
  } catch {
    /* источник — для аналитики продавца, заказ уже оформлен */
  }
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

/**
 * Потолок штук одной позиции в заказе с сайта: оформляет его кто угодно,
 * и без потолка один запрос списал бы со склада всё. Больше — через бота
 * или продавца.
 */
export const WEB_MAX_QTY = 5;

export type WebPlaceResult =
  | PlaceOrderResult
  | { ok: false; reason: "nothing_imported" | "too_many" }
  | Extract<WebFulfillmentCheck, { ok: false }>;

/**
 * Корзина с сайта → заказ. Корзина покупателя в базе сначала очищается:
 * на сайте он видит только то, что сейчас в браузере. Для физических
 * товаров способ получения, дата и адрес проверяются по корзине в базе
 * (срок изготовления её товаров) до placeOrder.
 */
export async function placeWebOrder(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
  countryCode: string,
  opts: {
    fulfillment?: WebFulfillmentRequest | null;
    /** Контакты, введённые в этом оформлении: в заказ, а не в покупателя. */
    contact?: { name: string; phone: string | null };
  } = {},
): Promise<WebPlaceResult> {
  if (items.some((it) => Number(it.quantity) > WEB_MAX_QTY))
    return { ok: false, reason: "too_many" };
  // Покупатель из бота (вошёл через Telegram): его корзина в боте — не
  // корзина сайта. Откладываем её и возвращаем после оформления.
  const botCart = customer.userKey.startsWith("web_") ? null : await takeBotCart(ctx, customer);
  try {
    return await placeFromCart(ctx, customer, items, countryCode, opts);
  } finally {
    if (botCart) await restoreBotCart(ctx, customer, botCart);
  }
}

type CartRow = { product_id: string; product_variant_id: string | null; quantity: number };

async function takeBotCart(ctx: TenantContext, customer: Customer): Promise<CartRow[]> {
  const { data, error } = await ctx.db
    .from("cart_items")
    .select("product_id, product_variant_id, quantity")
    .eq("telegram_id", customer.telegramId)
    .order("created_at")
    .order("id");
  if (error) throw new Error(`cart: ${error.message}`);
  return data ?? [];
}

async function restoreBotCart(
  ctx: TenantContext,
  customer: Customer,
  rows: CartRow[],
): Promise<void> {
  await clearCart(ctx, customer);
  if (rows.length === 0) return;
  const { error } = await ctx.db.from("cart_items").insert(
    rows.map((r) => ({
      bot_id: ctx.tenant.id,
      telegram_id: customer.telegramId,
      user_key: customer.userKey,
      product_id: r.product_id,
      product_variant_id: r.product_variant_id,
      quantity: r.quantity,
    })),
  );
  if (error) console.error(`[web-order:${ctx.tenant.id}] корзина бота не вернулась`, error.message);
}

async function placeFromCart(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
  countryCode: string,
  opts: Parameters<typeof placeWebOrder>[4] = {},
): Promise<WebPlaceResult> {
  await clearCart(ctx, customer);
  if ((await importItems(ctx, customer, items)) === 0)
    return { ok: false, reason: "nothing_imported" };
  const cart = await listCart(ctx, customer);
  let r: PlaceOrderResult;
  if (!cart.some((it) => it.products?.fulfillment_kind === "physical")) {
    r = await placeOrder(ctx, customer, countryCode);
  } else {
    const f = await resolveWebFulfillment(ctx, customer, opts.fulfillment, countryCode);
    if (!f.ok) {
      await clearCart(ctx, customer);
      return f;
    }
    r = await placeOrder(ctx, customer, countryCode, { fulfillment: f.input });
  }
  if (!r.ok || !opts.contact) return r;
  const patch = {
    display_name: opts.contact.name.slice(0, 64),
    contact: opts.contact.phone,
  };
  await ctx.db.from("orders").update(patch).eq("id", r.order.id);
  return { ...r, order: { ...r.order, ...patch } };
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
   * Как платить: реквизиты и QR способа оплаты страны заказа и/или карта
   * через Robokassa продавца; null — платить не нужно.
   */
  payment: { instructions: string | null; qr: string | null; card: boolean } | null;
  materials: WebMaterial[];
  email: string | null;
  /** Чек загружен — заказ на проверке у продавца по чеку, а не по контактам. */
  proof: boolean;
};

const PAYABLE = new Set(["awaiting_payment"]);

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

export async function webOrderView(
  ctx: TenantContext,
  orderId: number,
): Promise<WebOrderView | null> {
  const order = await getOrder(ctx, orderId);
  if (!order || !(await hasOrderPage(ctx, order))) return null;
  const payable = PAYABLE.has(order.status);
  const method =
    payable && order.country_code ? await paymentMethodFor(ctx, order.country_code) : null;
  const card = payable && (await robokassaFor(ctx)).ready;
  return {
    id: order.id,
    no: displayNo(order),
    status: order.status,
    total: Number(order.total),
    due: payable
      ? await amountDueNow(ctx, {
          total: Number(order.total),
          fulfillment_kind: order.fulfillment_kind,
        })
      : 0,
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
            address: order.fulfillment_address,
            zone: order.delivery_zone_name,
            fee: Number(order.delivery_fee) || 0,
          }
        : null,
    items: (order.order_items ?? []).map((i) => ({
      name: i.name_snapshot,
      qty: Number(i.quantity),
      price: Number(i.price_snapshot),
    })),
    payment:
      method || card
        ? {
            instructions: method?.instructions ?? null,
            qr: method?.qr_code_path ? imageUrl(ctx, method.qr_code_path) : null,
            card,
          }
        : null,
    materials: await webOrderMaterials(ctx, order),
    email: order.customer_email,
    proof: Boolean(order.payment_proof_path),
  };
}

/**
 * Ссылка на оплату картой через Robokassa продавца (его логин и пароли), на
 * сумму к оплате сейчас. null — заказ уже не ждёт оплаты или Robokassa у
 * продавца не подключена. Оплату подтверждает только колбэк result.
 */
export async function webCardPaymentUrl(
  ctx: TenantContext,
  orderId: number,
): Promise<string | null> {
  const order = await getOrder(ctx, orderId);
  if (!order || !PAYABLE.has(order.status) || !(await hasOrderPage(ctx, order))) return null;
  const rk = await robokassaFor(ctx);
  if (!rk.ready) return null;
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  if (!(due > 0)) return null;
  return buildPaymentUrl(rk, {
    outSum: due,
    invId: order.id,
    description: `Заказ #${displayNo(order)}`,
    botId: ctx.tenant.id,
  });
}
