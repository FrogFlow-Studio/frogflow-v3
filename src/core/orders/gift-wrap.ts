import { shopCurrency, toOrderCurrency } from "@/core/discounts/discounts";
import { getSettingStrict, setSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Подарочная упаковка (модуль `bundles`): продавец включает её и ставит цену
 * в валюте магазина — app_settings `gift_wrap` = {"on":true,"price":500}.
 * Покупатель, отметивший заказ подарком, может её взять. В заказе упаковка —
 * отдельная позиция (order_items, без товара) с меткой GIFT_WRAP_MARK: так её
 * сумма сама попадает в итог, чек, страницу заказа и выгрузки. Промокод её не
 * скидывает: упаковка прибавляется к итогу после скидок. Решает placeOrder, а
 * подсказки каналов берут сумму из `giftWrapFee` — той же функции.
 */
export const GIFT_WRAP_KEY = "gift_wrap";
export const GIFT_WRAP_MAX = 100_000_000;
/** Невидимая метка в начале названия позиции: по ней упаковку узнают аналитика и прибыль. */
export const GIFT_WRAP_MARK = "🎁⁣";

export type GiftWrapSetting = { on: boolean; price: number };

export function parseGiftWrap(raw: string | null | undefined): GiftWrapSetting {
  try {
    const j = JSON.parse(raw ?? "null") as { on?: unknown; price?: unknown } | null;
    const price = Number(j?.price);
    return {
      on: j?.on === true && Number.isFinite(price) && price > 0 && price <= GIFT_WRAP_MAX,
      price: Number.isFinite(price) && price > 0 && price <= GIFT_WRAP_MAX ? price : 0,
    };
  } catch {
    return { on: false, price: 0 };
  }
}

/** Настройка упаковки; сбой чтения — сбой, а не «упаковки нет». */
export async function loadGiftWrap(ctx: TenantContext): Promise<GiftWrapSetting> {
  return parseGiftWrap(await getSettingStrict(ctx, GIFT_WRAP_KEY));
}

export async function saveGiftWrap(ctx: TenantContext, s: GiftWrapSetting): Promise<void> {
  const clean = parseGiftWrap(JSON.stringify(s));
  await setSetting(
    ctx,
    GIFT_WRAP_KEY,
    JSON.stringify({ on: s.on && clean.on, price: s.price > 0 ? clean.price : 0 }),
  );
}

/**
 * Цена упаковки в валюте заказа: `0` — упаковки нет (модуль или опция выключены),
 * `null` — цену не перевести (курса нет), упаковку не продаём.
 */
export async function giftWrapFee(
  ctx: TenantContext,
  orderCurrency: string,
): Promise<number | null> {
  if (!ctx.tenant.modules.bundles) return 0;
  const s = await loadGiftWrap(ctx);
  if (!s.on) return 0;
  return toOrderCurrency(s.price, await shopCurrency(ctx), orderCurrency);
}

/**
 * Сколько упаковка прибавит к корзине в её валюте — для подсказок каналов.
 * 0 — предлагать нечего: модуль или опция выключены, заказ цифровой, цену не перевести.
 */
export async function giftWrapForCart(
  ctx: TenantContext,
  priced: { kind: string; currency: string },
): Promise<number> {
  if (priced.kind !== "physical") return 0;
  const fee = await giftWrapFee(ctx, priced.currency);
  return fee && fee > 0 ? fee : 0;
}

const NAMES = {
  ru: "Подарочная упаковка",
  kk: "Сыйлық қаптамасы",
  en: "Gift wrapping",
  uz: "Sovgʻa qadogʻi",
} as const;

/** Название позиции заказа на языке покупателя, с меткой. */
export function giftWrapName(locale: string | null | undefined): string {
  return `${GIFT_WRAP_MARK}${NAMES[(locale as keyof typeof NAMES) in NAMES ? (locale as keyof typeof NAMES) : "ru"]}`;
}

export const isGiftWrapRow = (name: string | null | undefined): boolean =>
  Boolean(name?.startsWith(GIFT_WRAP_MARK));
