import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { generateGiftCode } from "./pure";

/**
 * Продажа подарочных сертификатов на витрине сайта. Продавец включает её и
 * задаёт номиналы в `bots.settings.gift_sale` (по умолчанию выключено).
 * Покупка — обычный цифровой заказ с сайта с одной позицией без товара;
 * номинал лежит в метке `gift_sale:<заказ>` (app_settings), схема базы не
 * меняется. Код создаётся только при выдаче, то есть после подтверждённой
 * оплаты, и ровно один: какой код выдан, решает условная запись в метку.
 */
export const GIFT_SALE_PREFIX = "gift_sale:";
export const GIFT_SALE_MAX_AMOUNTS = 6;
export const GIFT_SALE_MAX_AMOUNT = 10_000_000;

export type GiftSaleSettings = { enabled: boolean; amounts: number[]; currency: string };

/** Номиналы: целые, положительные, без повторов, по возрастанию, не больше шести. */
export function normalizeGiftAmounts(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ok = raw
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0 && v <= GIFT_SALE_MAX_AMOUNT);
  return [...new Set(ok)].sort((a, b) => a - b).slice(0, GIFT_SALE_MAX_AMOUNTS);
}

export function giftSaleSettings(ctx: TenantContext): GiftSaleSettings {
  const s = ctx.tenant.settings.gift_sale;
  const currency =
    typeof s?.currency === "string" && /^[A-Z]{3}$/.test(s.currency) ? s.currency : "KZT";
  return { enabled: s?.enabled === true, amounts: normalizeGiftAmounts(s?.amounts), currency };
}

/** Продажа открыта: модуль сертификатов, настройка продавца и хотя бы один номинал. */
export function giftSaleOpen(ctx: TenantContext): boolean {
  const s = giftSaleSettings(ctx);
  return Boolean(ctx.tenant.modules.gift_certificates) && s.enabled && s.amounts.length > 0;
}

export type GiftSale = { amount: number; currency: string; code?: string };

function parseSale(raw: string | null | undefined): GiftSale | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<GiftSale>;
    if (typeof p.amount !== "number" || !(p.amount > 0) || typeof p.currency !== "string")
      return null;
    return {
      amount: p.amount,
      currency: p.currency,
      ...(typeof p.code === "string" && p.code ? { code: p.code } : {}),
    };
  } catch {
    return null;
  }
}

async function readSale(
  ctx: TenantContext,
  orderId: number,
): Promise<{ raw: string; sale: GiftSale } | null> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("bot_id", ctx.tenant.id)
    .eq("key", `${GIFT_SALE_PREFIX}${orderId}`)
    .maybeSingle();
  if (error) throw serverFailure(`метка сертификата заказа ${orderId}: ${error.message}`);
  const sale = parseSale(data?.value);
  return sale && data?.value ? { raw: data.value, sale } : null;
}

/** Номинал заказа-сертификата; null — это обычный заказ. */
export async function giftSaleOf(ctx: TenantContext, orderId: number): Promise<GiftSale | null> {
  return (await readSale(ctx, orderId))?.sale ?? null;
}

/** Отметить заказ как покупку сертификата — сразу после вставки заказа. */
export async function markGiftSale(
  ctx: TenantContext,
  orderId: number,
  sale: { amount: number; currency: string },
): Promise<boolean> {
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `${GIFT_SALE_PREFIX}${orderId}`,
    value: JSON.stringify({ amount: sale.amount, currency: sale.currency }),
    updated_at: new Date().toISOString(),
  });
  return !error;
}

/** Имя позиции в заказе и в админке: «Подарочный сертификат 10 000 ₸». */
export const GIFT_ITEM_NAME = "Подарочный сертификат";

export type IssuedGift = { code: string; amount: number; currency: string };

/**
 * Выдать код по оплаченному заказу. Повторный вызов (повторная выдача,
 * гонка двух колбэков) возвращает тот же код: кандидат записывается в метку
 * условно — только поверх значения без кода, — и выигравший код читается
 * из метки заново. Строка gift_certificates создаётся под этим кодом; если
 * такой код в магазине уже занят чужим сертификатом, кандидат меняется
 * той же условной записью.
 */
export async function issueGiftForOrder(
  ctx: TenantContext,
  order: { id: number; display_no?: number | null; order_no?: number | null },
  gen: () => string = generateGiftCode,
): Promise<IssuedGift | null> {
  const key = `${GIFT_SALE_PREFIX}${order.id}`;
  const no = order.display_no ?? order.order_no ?? order.id;
  const note = `Куплен на сайте, заказ №${no}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await readSale(ctx, order.id);
    if (!cur) return null;
    let { sale, raw } = cur;
    if (!sale.code) {
      const next = JSON.stringify({ amount: sale.amount, currency: sale.currency, code: gen() });
      const set = await ctx.db
        .from("app_settings")
        .update({ value: next, updated_at: new Date().toISOString() })
        .eq("bot_id", ctx.tenant.id)
        .eq("key", key)
        .eq("value", cur.raw);
      if (set.error)
        throw serverFailure(`код сертификата заказа ${order.id}: ${set.error.message}`);
      const won = await readSale(ctx, order.id);
      if (!won?.sale.code) continue;
      ({ sale, raw } = won);
    }
    const code = sale.code!;
    const own = await ctx.db
      .from("gift_certificates")
      .select("id, amount, note")
      .eq("bot_id", ctx.tenant.id)
      .eq("code", code)
      .maybeSingle();
    if (own.error) throw serverFailure(`сертификат ${order.id}: ${own.error.message}`);
    if (own.data) {
      if (own.data.note === note && Number(own.data.amount) === sale.amount)
        return { code, amount: sale.amount, currency: sale.currency };
      // Код занят другим сертификатом магазина — сменить кандидата.
      const reset = await ctx.db
        .from("app_settings")
        .update({
          value: JSON.stringify({ amount: sale.amount, currency: sale.currency }),
          updated_at: new Date().toISOString(),
        })
        .eq("bot_id", ctx.tenant.id)
        .eq("key", key)
        .eq("value", raw);
      if (reset.error)
        throw serverFailure(`код сертификата заказа ${order.id}: ${reset.error.message}`);
      continue;
    }
    const { error } = await ctx.db.from("gift_certificates").insert({
      bot_id: ctx.tenant.id,
      code,
      amount: sale.amount,
      currency: sale.currency,
      note,
      status: "active",
    });
    // Ошибка вставки — возможно, параллельная выдача успела раньше: сверка
    // на следующем круге по той же строке.
    if (!error) return { code, amount: sale.amount, currency: sale.currency };
    if (error.code !== "23505")
      throw serverFailure(`сертификат заказа ${order.id}: ${error.message}`);
  }
  return null;
}
