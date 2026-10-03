import type { TenantContext } from "@/core/tenant/resolve.server";
import { chunksOf, inChunks } from "@/lib/in-chunks";
import { servedByV2 } from "@/core/tenant/directory";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";

/**
 * «Заканчивается на складе»: когда остаток товара падает до порога или ниже,
 * продавцу уходит одно сообщение. Порог — на магазин (`low_stock_default`) и
 * на товар (`low_stock_at:<id>`, перекрывает магазинный; 0 — не предупреждать).
 * Своих колонок нет (схема не меняется): всё в app_settings.
 *
 * «Один раз» держит отметка `low_stock_sent:<id>`: её ставит вставка строки
 * (PK bot_id+key), и только выигравшая вставка отдаёт товар на отправку —
 * две оплаты подряд или два вебхука одновременно дают одно сообщение.
 * Отметку снимает пополнение выше порога (resetLowStock), после чего новое
 * падение снова предупреждает. Только клиентам v2 и при модуле «Склад».
 */
export const LOW_STOCK_DEFAULT_KEY = "low_stock_default";
export const LOW_STOCK_MAX = 100_000;
export const lowStockProductKey = (id: string) => `low_stock_at:${id}`;
export const lowStockSentKey = (id: string) => `low_stock_sent:${id}`;
/** Товаров за один запрос настроек: по три ключа на товар, `.in` не длиннее 200. */
const CHUNK = 50;

/** Порог из строки настройки: целое 0…LOW_STOCK_MAX; иное — не задан. */
export function parseThreshold(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= LOW_STOCK_MAX ? n : null;
}

export type LowStockItem = { id: string; name: string; stock: number; threshold: number };

type Stocked = { id: string; name: string; stock_quantity: number | null };

async function readProducts(ctx: TenantContext, ids: string[]): Promise<Stocked[]> {
  return inChunks(
    ids,
    (chunk) =>
      ctx.db.from("products").select("id, name, stock_quantity").in("id", chunk).order("id"),
    "Остаток товара",
  );
}

/** Настройки порогов и отметки по товарам: одним чтением на пачку. */
async function readSettings(ctx: TenantContext, ids: string[]) {
  const values: Record<string, string> = {};
  for (const chunk of chunksOf(ids, CHUNK)) {
    const keys = [
      LOW_STOCK_DEFAULT_KEY,
      ...chunk.flatMap((id) => [lowStockProductKey(id), lowStockSentKey(id)]),
    ];
    Object.assign(values, await getSettingsStrict(ctx, keys));
  }
  return {
    shop: parseThreshold(values[LOW_STOCK_DEFAULT_KEY]) ?? 0,
    own: (id: string) => parseThreshold(values[lowStockProductKey(id)]),
    sent: (id: string) => values[lowStockSentKey(id)] !== undefined,
  };
}

const active = (ctx: TenantContext) => ctx.tenant.modules.stock && servedByV2(ctx.tenant);

/**
 * Товары заказа, у которых остаток упал до порога и по которым это сообщение
 * ещё не уходило. Возвращает только тех, кого отметила именно эта проверка.
 * Товары с остатком выше порога заодно снимают устаревшую отметку.
 */
export async function claimLowStock(
  ctx: TenantContext,
  productIds: readonly string[],
): Promise<LowStockItem[]> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0 || !active(ctx)) return [];
  const products = await readProducts(ctx, ids);
  const cfg = await readSettings(
    ctx,
    products.map((p) => p.id),
  );
  const won: LowStockItem[] = [];
  for (const p of products) {
    if (p.stock_quantity === null) continue;
    const threshold = cfg.own(p.id) ?? cfg.shop;
    if (threshold <= 0) continue;
    if (p.stock_quantity > threshold) {
      if (cfg.sent(p.id)) await dropMark(ctx, p.id);
      continue;
    }
    if (cfg.sent(p.id)) continue;
    if (await takeMark(ctx, p.id))
      won.push({ id: p.id, name: p.name, stock: p.stock_quantity, threshold });
  }
  return won;
}

/** Вставка отметки; true — вставила эта проверка (повтор ключа 23505 — уже занята). */
async function takeMark(ctx: TenantContext, id: string): Promise<boolean> {
  const { error } = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key: lowStockSentKey(id), value: "1" });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw serverFailure(`Остаток товара: отметка не записана: ${error.message}`);
}

async function dropMark(ctx: TenantContext, id: string): Promise<void> {
  const { error } = await ctx.db.from("app_settings").delete().eq("key", lowStockSentKey(id));
  if (error) throw serverFailure(`Остаток товара: отметка не снята: ${error.message}`);
}

/**
 * Остаток пополнили (правка карточки, возврат при отмене): если он снова выше
 * порога — отметка снимается, следующее падение предупредит заново.
 */
export async function resetLowStock(ctx: TenantContext, productId: string): Promise<void> {
  if (!active(ctx)) return;
  const [p] = await readProducts(ctx, [productId]);
  const cfg = await readSettings(ctx, [productId]);
  if (!cfg.sent(productId)) return;
  if (!p || p.stock_quantity === null || p.stock_quantity > (cfg.own(productId) ?? cfg.shop))
    await dropMark(ctx, productId);
}

/** Язык сообщений продавцу: язык админки, иначе язык магазина, иначе русский. */
export async function sellerLocale(ctx: TenantContext): Promise<Locale> {
  const st = await getSettingsStrict(ctx, ["admin_locale"]);
  return isLocale(st.admin_locale) ? st.admin_locale : (ctx.tenant.settings.default_locale ?? "ru");
}

const TEXT: Record<Locale, (name: string, stock: number, threshold: number) => string> = {
  ru: (n, s, t) =>
    `📉 Заканчивается на складе: <b>${n}</b>\nОсталось: ${s} (порог ${t}). Пополните остаток в карточке товара.`,
  kk: (n, s, t) =>
    `📉 Қоймада таусылып барады: <b>${n}</b>\nҚалды: ${s} (шек ${t}). Тауар картасында қалдықты толықтырыңыз.`,
  en: (n, s, t) =>
    `📉 Running low: <b>${n}</b>\nLeft: ${s} (threshold ${t}). Update the stock in the product card.`,
  uz: (n, s, t) =>
    `📉 Omborda tugab bormoqda: <b>${n}</b>\nQoldi: ${s} (chegara ${t}). Mahsulot kartasida qoldiqni toʻldiring.`,
};

/** Сообщение продавцу (HTML Telegram); название экранируется вызывающим. */
export function lowStockText(locale: Locale, item: LowStockItem, escapedName: string): string {
  return TEXT[locale](escapedName, item.stock, item.threshold);
}

/** Порог магазина и порог товара (null — у товара свой не задан) для форм админки. */
export async function loadThresholds(
  ctx: TenantContext,
  productId: string | null,
): Promise<{ shop: number; own: number | null }> {
  const keys = [LOW_STOCK_DEFAULT_KEY, ...(productId ? [lowStockProductKey(productId)] : [])];
  const v = await getSettingsStrict(ctx, keys);
  return {
    shop: parseThreshold(v[LOW_STOCK_DEFAULT_KEY]) ?? 0,
    own: productId ? parseThreshold(v[lowStockProductKey(productId)]) : null,
  };
}

export async function saveShopThreshold(ctx: TenantContext, value: number): Promise<void> {
  await setSetting(ctx, LOW_STOCK_DEFAULT_KEY, String(Math.min(Math.max(0, value), LOW_STOCK_MAX)));
}

/** Свой порог товара; null — вернуться к магазинному. Правка порога заново проверяет отметку. */
export async function saveProductThreshold(
  ctx: TenantContext,
  productId: string,
  value: number | null,
): Promise<void> {
  const key = lowStockProductKey(productId);
  if (value === null) {
    const { error } = await ctx.db.from("app_settings").delete().eq("key", key);
    if (error) throw serverFailure(`Порог остатка не снят: ${error.message}`);
  } else await setSetting(ctx, key, String(Math.min(Math.max(0, value), LOW_STOCK_MAX)));
  await resetLowStock(ctx, productId);
}
