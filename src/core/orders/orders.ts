import { createHash } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import { serviceDb } from "@/core/db/client.server";
import type { Customer } from "@/core/customers/customers";
import { setState } from "@/core/customers/customers";
import { listCart, clearCart, priceCart, type CartItem } from "@/core/cart/cart";
import {
  materialLanguages,
  materialsForProduct,
  type MaterialSnapshot,
} from "@/core/catalog/materials";
import type { Locale } from "@/core/i18n/locale";
import { itemLanguages, itemMaterials } from "./pure";
import { applyDiscounts, normalizeCode } from "@/core/discounts/pure";
import { amountDueNow, decrementStock, restoreStock } from "@/core/fulfillment/fulfillment";
import {
  awardPointsForOrder,
  findValidGift,
  findValidPromoCode,
  loyaltyBalance,
  redeemGift,
  redeemPoints,
  redeemPromoCode,
  rollbackRedemptions,
  type Redemptions,
} from "@/core/discounts/discounts";

export { displayNo, itemLanguages, itemMaterials } from "./pure";

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
export type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
export type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };
export type PaymentMethodRow = Database["public"]["Tables"]["payment_methods"]["Row"];

export const DELIVERABLE_STATUSES = ["awaiting_payment", "awaiting_confirmation", "paid"] as const;
export const REJECTABLE_STATUSES = [
  ...DELIVERABLE_STATUSES,
  "accepted",
  "in_production",
  "ready",
] as const;

export async function listActivePaymentMethods(ctx: TenantContext): Promise<PaymentMethodRow[]> {
  const { data } = await ctx.db
    .from("payment_methods")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  return data ?? [];
}

export async function paymentMethodFor(
  ctx: TenantContext,
  countryCode: string,
): Promise<PaymentMethodRow | null> {
  const { data } = await ctx.db
    .from("payment_methods")
    .select("*")
    .eq("country_code", countryCode)
    .eq("is_active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Атомарный захват оформления: RPC claim_order_placement (MIGRATION-27)
 * ставит bot_users.state.placing_order одним оператором. Двойной тап по
 * «Оформить» не создаёт второго заказа. CAS по updated_at здесь не годится —
 * его двигает триггер на любой апдейт строки.
 */
export async function claimOrderPlacement(
  ctx: TenantContext,
  customer: Customer,
): Promise<boolean> {
  const { data, error } = await ctx.db.rpc("claim_order_placement", {
    p_bot_id: ctx.tenant.id,
    p_telegram_id: customer.telegramId,
  });
  if (error) throw new Error(`claim_order_placement: ${error.message}`);
  return data === true;
}

export async function releaseOrderPlacement(
  ctx: TenantContext,
  customer: Customer,
  state = customer.state,
): Promise<void> {
  const { placing_order: _p, ...rest } = state;
  await setState(ctx, customer, rest);
}

export type PlaceOrderResult =
  | {
      ok: true;
      order: OrderWithItems;
      method: PaymentMethodRow;
      priced: Awaited<ReturnType<typeof priceCart>>;
      /** Скидки покрыли всё: чек не нужен, заказ можно выдавать сразу. */
      zeroTotal: boolean;
      /** Сколько платить сейчас: задаток или ноль при оплате при получении. */
      amountDue: number;
    }
  | {
      ok: false;
      reason:
        | "busy"
        | "empty_cart"
        | "country_unavailable"
        | "order_failed"
        | "promo_invalid"
        | "gift_invalid"
        | "out_of_stock";
    };

export type FulfillmentInput = {
  type: "pickup" | "delivery" | null;
  at: string | null;
  address: string | null;
  note: string | null;
  zone: { id: string; name: string; fee: number } | null;
};

export type PlaceOrderOptions = {
  promoCode?: string | null;
  usePoints?: boolean;
  giftCode?: string | null;
  fulfillment?: FulfillmentInput | null;
};

/** Скидки корзины для показа — без списания. */
export type CartSummary = {
  subtotal: number;
  currency: string;
  promo: { code: string; discount: number } | null;
  promoInvalid: boolean;
  points: { balance: number; discount: number; used: boolean };
  gift: { code: string; discount: number } | null;
  giftInvalid: boolean;
  total: number;
};

export async function cartSummary(
  ctx: TenantContext,
  customer: Customer,
  priced: { total: number; currency: string },
  opts: PlaceOrderOptions,
): Promise<CartSummary> {
  const m = ctx.tenant.modules;
  const promoCode = m.coupons && opts.promoCode ? normalizeCode(opts.promoCode) : null;
  const promo = promoCode ? await findValidPromoCode(ctx, promoCode) : null;
  const giftCode = m.gift_certificates && opts.giftCode ? normalizeCode(opts.giftCode) : null;
  const gift = giftCode ? await findValidGift(ctx, giftCode) : null;
  const balance = m.loyalty ? await loyaltyBalance(ctx, customer.telegramId) : 0;
  const usePoints = Boolean(m.loyalty && opts.usePoints && balance > 0);
  const r = applyDiscounts(priced.total, {
    promo: promo?.ok ? promo.promo : null,
    points: usePoints ? balance : 0,
    gift: gift?.ok ? gift.certificate.amount : null,
  });
  return {
    subtotal: priced.total,
    currency: priced.currency,
    promo: promoCode && promo?.ok ? { code: promoCode, discount: r.promo } : null,
    promoInvalid: Boolean(promoCode && !promo?.ok),
    points: { balance, discount: r.points, used: usePoints },
    gift: giftCode && gift?.ok ? { code: giftCode, discount: r.gift } : null,
    giftInvalid: Boolean(giftCode && !gift?.ok),
    total: r.total,
  };
}

/**
 * Создать заказ из корзины: снимок цен и файлов в order_items, номер через
 * триггер из order_counters, корзина очищается только после успешной
 * вставки позиций (иначе покупатель платит за заказ без состава).
 *
 * Не здесь: промокоды, баллы, сертификаты, складское списание, физическая
 * доставка, «все языки» — это следующие фазы переноса (docs/ROADMAP.md),
 * каждая под своим модулем.
 */
export async function placeOrder(
  ctx: TenantContext,
  customer: Customer,
  countryCode: string,
  opts: PlaceOrderOptions = {},
): Promise<PlaceOrderResult> {
  if (!(await claimOrderPlacement(ctx, customer))) return { ok: false, reason: "busy" };
  const redemptions: Redemptions = {};
  const reserved: Array<{ productId: string; qty: number }> = [];
  const fail = async (reason: Extract<PlaceOrderResult, { ok: false }>["reason"]) => {
    for (const r of reserved) await restoreStock(ctx, r.productId, r.qty);
    await rollbackRedemptions(ctx, customer, redemptions);
    await releaseOrderPlacement(ctx, customer);
    return { ok: false as const, reason };
  };
  try {
    const method = await paymentMethodFor(ctx, countryCode);
    if (!method) {
      const { country_code: _c, country_name: _n, ...rest } = customer.state;
      await releaseOrderPlacement(ctx, customer, rest);
      return { ok: false, reason: "country_unavailable" };
    }
    const items = (await listCart(ctx, customer)).filter((it) => it.products);
    if (items.length === 0) {
      await releaseOrderPlacement(ctx, customer);
      return { ok: false, reason: "empty_cart" };
    }
    const priced = await priceCart(ctx, items, countryCode);

    // Складской учёт — до создания заказа: не хватило, откатываем уже
    // списанное и убираем раскупленную строку из корзины.
    if (ctx.tenant.modules.stock) {
      for (const it of items) {
        const ok = await decrementStock(ctx, it.products!.id, Number(it.quantity));
        if (!ok) {
          await ctx.db.from("cart_items").delete().eq("id", it.id);
          return await fail("out_of_stock");
        }
        reserved.push({ productId: it.products!.id, qty: Number(it.quantity) });
      }
    }
    const f = priced.kind === "physical" ? (opts.fulfillment ?? null) : null;
    const deliveryFee = f?.type === "delivery" && f.zone ? f.zone.fee : 0;

    // Скидки в порядке v1: промокод → баллы → сертификат. Каждая списывается
    // атомарно; сорвалось ниже — всё возвращается через rollbackRedemptions.
    const m = ctx.tenant.modules;
    // Комиссия зоны до скидок: скидка действует и на доставку.
    let total = priced.total + deliveryFee;
    let promoCode: string | null = null;
    let discountAmount = 0;
    if (m.coupons && opts.promoCode) {
      const r = await redeemPromoCode(ctx, opts.promoCode, total);
      if (!r.ok) return await fail("promo_invalid");
      promoCode = normalizeCode(opts.promoCode);
      discountAmount = r.discount;
      redemptions.promo = { id: r.promoId, previousUsedCount: r.previousUsedCount };
      total -= discountAmount;
    }
    let pointsUsed = 0;
    if (m.loyalty && opts.usePoints) {
      pointsUsed = await redeemPoints(ctx, customer.telegramId, total);
      redemptions.pointsUsed = pointsUsed;
      total -= pointsUsed;
    }
    let giftCode: string | null = null;
    let giftDiscount = 0;
    if (m.gift_certificates && opts.giftCode) {
      const r = await redeemGift(ctx, opts.giftCode, total, customer.telegramId);
      if (!r.ok) return await fail("gift_invalid");
      giftCode = normalizeCode(opts.giftCode);
      giftDiscount = r.discount;
      redemptions.giftId = r.certificateId;
      total -= giftDiscount;
    }
    total = Math.max(0, total);

    const display =
      [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
      (customer.username ? `@${customer.username}` : `id${customer.telegramId}`);

    const { data: order, error } = await ctx.db
      .from("orders")
      .insert({
        bot_id: ctx.tenant.id,
        telegram_id: customer.telegramId,
        user_key: customer.userKey,
        platform: customer.platform,
        username: customer.username,
        display_name: display,
        contact: customer.contactPhone,
        country_code: method.country_code,
        country_name: method.country_name,
        total,
        currency: priced.currency,
        status: "awaiting_payment",
        fulfillment_kind: priced.kind,
        promo_code: promoCode,
        discount_amount: discountAmount,
        points_used: pointsUsed,
        gift_certificate_code: giftCode,
        gift_certificate_discount: giftDiscount,
        fulfillment_type: f?.type ?? null,
        fulfillment_at: f?.at ? `${f.at}T00:00:00Z` : null,
        fulfillment_address: f?.type === "delivery" ? f.address : null,
        fulfillment_note: f?.note ?? null,
        delivery_zone_id: f?.type === "delivery" ? (f.zone?.id ?? null) : null,
        delivery_zone_name: f?.type === "delivery" ? (f.zone?.name ?? null) : null,
        delivery_fee: deliveryFee,
      })
      .select("*")
      .single();
    if (error || !order) return await fail("order_failed");
    redemptions.orderId = order.id;
    if (redemptions.giftId) {
      await ctx.db
        .from("gift_certificates")
        .update({ redeemed_order_id: order.id })
        .eq("id", redemptions.giftId);
    }

    const rows = priced.lines.map(({ item, unit, name }) =>
      orderItemSnapshot(ctx, order.id, item, unit.amount, name),
    );
    const { error: itemsError } = await ctx.db.from("order_items").insert(rows);
    if (itemsError) {
      await ctx.db.from("orders").delete().eq("id", order.id);
      return await fail("order_failed");
    }
    await clearCart(ctx, customer);
    // Захват снимается здесь, а не в канале: иначе следующая кнопка
    // «Оформить» молча упирается в placing_order (поймано интеграционным
    // тестом на живой базе).
    await releaseOrderPlacement(ctx, customer);
    const { data: full } = await ctx.db
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", order.id)
      .single();
    const finalOrder = (full ?? { ...order, order_items: [] }) as OrderWithItems;
    return {
      ok: true,
      order: finalOrder,
      method,
      priced,
      zeroTotal: total <= 0,
      amountDue: total <= 0 ? 0 : await amountDueNow(ctx, { total, fulfillment_kind: priced.kind }),
    };
  } catch (e) {
    for (const r of reserved) await restoreStock(ctx, r.productId, r.qty).catch(() => {});
    await rollbackRedemptions(ctx, customer, redemptions).catch(() => {});
    await releaseOrderPlacement(ctx, customer).catch(() => {});
    throw e;
  }
}

function orderItemSnapshot(
  ctx: TenantContext,
  orderId: number,
  item: CartItem,
  price: number,
  name: string,
) {
  const p = item.products!;
  const byLang: Record<string, MaterialSnapshot[]> = {};
  for (const lang of materialLanguages(p)) byLang[lang] = materialsForProduct(p, lang);
  return {
    bot_id: ctx.tenant.id,
    order_id: orderId,
    product_id: p.id,
    product_variant_id: item.product_variant_id,
    name_snapshot: name,
    price_snapshot: price,
    quantity: item.quantity,
    file_path_snapshot: p.file_path ?? null,
    file_name_snapshot: p.file_name ?? null,
    file_path_kz_snapshot: p.file_path_kz ?? null,
    file_name_kz_snapshot: p.file_name_kz ?? null,
    file_url_snapshot: p.file_url ?? null,
    file_url_kz_snapshot: p.file_url_kz ?? null,
    material_files_snapshot: (byLang.ru ?? []) as unknown as Json,
    material_files_kz_snapshot: (byLang.kk ?? []) as unknown as Json,
    material_files_by_lang: byLang as unknown as Json,
  };
}

export async function getOrder(ctx: TenantContext, id: number): Promise<OrderWithItems | null> {
  const { data } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as OrderWithItems | null) ?? null;
}

export async function listCustomerOrders(
  ctx: TenantContext,
  customer: Customer,
  limit = 20,
): Promise<OrderWithItems[]> {
  const { data } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("telegram_id", customer.telegramId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as OrderWithItems[];
}

/** Открытый заказ, ждущий чек, не старше суток — запасной путь, если состояние потерялось. */
export async function recentAwaitingPaymentOrder(
  ctx: TenantContext,
  customer: Customer,
  windowMs = 24 * 3600_000,
): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await ctx.db
    .from("orders")
    .select("id")
    .eq("telegram_id", customer.telegramId)
    .eq("status", "awaiting_payment")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export type ProofFile = { bytes: Uint8Array; mime: string; ext: string };

export type AttachProofResult =
  | { ok: true; order: OrderWithItems }
  | { ok: false; reason: "not_found" | "closed" | "duplicate" | "upload_failed" };

/**
 * Чек оплаты: в бакет payment-proofs под префиксом bot_id (изоляция
 * хранилища — префиксом пути, не RLS), хеш против повторной отправки того
 * же чека, статус awaiting_confirmation.
 */
export async function attachPaymentProof(
  ctx: TenantContext,
  orderId: number,
  file: ProofFile,
): Promise<AttachProofResult> {
  const order = await getOrder(ctx, orderId);
  if (!order) return { ok: false, reason: "not_found" };
  if (!["awaiting_payment", "awaiting_confirmation"].includes(order.status))
    return { ok: false, reason: "closed" };

  const hash = createHash("sha256").update(file.bytes).digest("hex");
  const { data: dup } = await ctx.db
    .from("orders")
    .select("id")
    .eq("payment_proof_hash", hash)
    .neq("id", orderId)
    .limit(1)
    .maybeSingle();
  if (dup) return { ok: false, reason: "duplicate" };

  const key = `${ctx.tenant.id}/order-${orderId}/${Date.now()}.${file.ext}`;
  const body = new Blob([file.bytes as BlobPart], {
    type: file.mime || "application/octet-stream",
  });
  const up = await serviceDb()
    .storage.from("payment-proofs")
    .upload(key, body, { contentType: file.mime, upsert: true });
  if (up.error) {
    console.error("[orders] proof upload failed", up.error);
    return { ok: false, reason: "upload_failed" };
  }
  const { data: updated } = await ctx.db
    .from("orders")
    .update({ payment_proof_path: key, payment_proof_hash: hash, status: "awaiting_confirmation" })
    .eq("id", orderId)
    .select("*, order_items(*)")
    .single();
  return { ok: true, order: (updated ?? order) as OrderWithItems };
}

/** CAS-захват на выдачу: из awaiting_* в delivering, иначе — уже выдан или нельзя. */
export async function claimOrderForDelivery(
  ctx: TenantContext,
  orderId: number,
): Promise<OrderWithItems | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .update({ status: "delivering", delivery_index: 0, delivery_retry_count: 0 })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("*, order_items(*)")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as OrderWithItems;
  const { data: existing } = await ctx.db
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (!existing) throw new Error("Заказ не найден");
  if (existing.status === "delivered" || existing.status === "delivering") return null;
  throw new Error(`Заказ #${orderId} нельзя выдать (статус: ${existing.status})`);
}

export async function rejectOrder(ctx: TenantContext, orderId: number): Promise<boolean> {
  const { data } = await ctx.db
    .from("orders")
    .update({ status: "rejected" })
    .eq("id", orderId)
    .in("status", [...REJECTABLE_STATUSES])
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export type MaterialSender = (
  item: OrderItemRow,
  materials: MaterialSnapshot[],
) => Promise<"sent" | "failed">;

export type DeliverResult = {
  ok: true;
  alreadyDelivered?: boolean;
  sent: number;
  failed: number;
  /** Начислено баллов за покупку (модуль loyalty), 0 — нет. */
  pointsEarned: number;
};

/**
 * Выдача цифрового заказа. Канал приносит функцию отправки; ядро отвечает
 * за захват, порядок, статусы и delivery_index (сколько позиций уже ушло —
 * повторная выдача продолжает, а не дублирует).
 */
export async function deliverOrder(
  ctx: TenantContext,
  orderId: number,
  send: MaterialSender,
  lang: Locale = "ru",
): Promise<DeliverResult> {
  const order = await claimOrderForDelivery(ctx, orderId);
  if (!order) return { ok: true, alreadyDelivered: true, sent: 0, failed: 0, pointsEarned: 0 };
  const items = order.order_items.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const langs = itemLanguages(item);
    const pick = langs.includes(lang) ? lang : langs[0];
    const materials = pick ? itemMaterials(item, pick) : [];
    const result = materials.length ? await send(item, materials) : "failed";
    if (result === "sent") sent++;
    else failed++;
    await ctx.db
      .from("orders")
      .update({ delivery_index: i + 1 })
      .eq("id", orderId);
  }
  await ctx.db
    .from("orders")
    .update(
      failed
        ? {
            status: "awaiting_confirmation",
            admin_note: `Выдача не удалась: ${failed} из ${items.length}`,
          }
        : { status: "delivered" },
    )
    .eq("id", orderId);
  const pointsEarned = failed
    ? 0
    : await awardPointsForOrder(ctx, orderId, order.telegram_id, Number(order.total));
  return { ok: true, sent, failed, pointsEarned };
}

export async function signedFileUrl(path: string, ttlSec = 7 * 24 * 3600): Promise<string | null> {
  const { data, error } = await serviceDb()
    .storage.from("product-files")
    .createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Файл из общего бакета принадлежит арендатору, только если лежит под его префиксом. */
export function isOwnStorageKey(ctx: TenantContext, key: string): boolean {
  return key.startsWith(`${ctx.tenant.id}/`);
}
