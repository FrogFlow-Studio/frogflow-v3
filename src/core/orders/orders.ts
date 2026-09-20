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

/** Номер для покупателя — замороженный display_no, не перенумеровываемый order_no. */
export function displayNo(o: Pick<OrderRow, "id" | "order_no" | "display_no">): number {
  return Number(o.display_no ?? o.order_no ?? o.id);
}

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
    }
  | { ok: false; reason: "busy" | "empty_cart" | "country_unavailable" | "order_failed" };

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
): Promise<PlaceOrderResult> {
  if (!(await claimOrderPlacement(ctx, customer))) return { ok: false, reason: "busy" };
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
        total: priced.total,
        currency: priced.currency,
        status: "awaiting_payment",
        fulfillment_kind: priced.kind,
      })
      .select("*")
      .single();
    if (error || !order) {
      await releaseOrderPlacement(ctx, customer);
      return { ok: false, reason: "order_failed" };
    }

    const rows = priced.lines.map(({ item, unit, name }) =>
      orderItemSnapshot(ctx, order.id, item, unit.amount, name),
    );
    const { error: itemsError } = await ctx.db.from("order_items").insert(rows);
    if (itemsError) {
      await ctx.db.from("orders").delete().eq("id", order.id);
      await releaseOrderPlacement(ctx, customer);
      return { ok: false, reason: "order_failed" };
    }
    await clearCart(ctx, customer);
    const { data: full } = await ctx.db
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", order.id)
      .single();
    return {
      ok: true,
      order: (full ?? { ...order, order_items: [] }) as OrderWithItems,
      method,
      priced,
    };
  } catch (e) {
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

export function itemMaterials(item: OrderItemRow, lang: Locale): MaterialSnapshot[] {
  const byLang = item.material_files_by_lang;
  if (byLang && typeof byLang === "object" && !Array.isArray(byLang)) {
    const arr = (byLang as Record<string, unknown>)[lang];
    if (Array.isArray(arr) && arr.length) return arr as MaterialSnapshot[];
  }
  // Старые заказы: одиночные колонки.
  if (lang === "ru" && (item.file_path_snapshot || item.file_url_snapshot)) {
    return [
      { path: item.file_path_snapshot, name: item.file_name_snapshot, url: item.file_url_snapshot },
    ];
  }
  if (lang === "kk" && (item.file_path_kz_snapshot || item.file_url_kz_snapshot)) {
    return [
      {
        path: item.file_path_kz_snapshot,
        name: item.file_name_kz_snapshot,
        url: item.file_url_kz_snapshot,
      },
    ];
  }
  return [];
}

export function itemLanguages(item: OrderItemRow): Locale[] {
  return (["ru", "kk", "en", "uz"] as const).filter((l) => itemMaterials(item, l).length > 0);
}

export type MaterialSender = (
  item: OrderItemRow,
  materials: MaterialSnapshot[],
) => Promise<"sent" | "failed">;

export type DeliverResult = { ok: true; alreadyDelivered?: boolean; sent: number; failed: number };

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
  if (!order) return { ok: true, alreadyDelivered: true, sent: 0, failed: 0 };
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
  return { ok: true, sent, failed };
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
