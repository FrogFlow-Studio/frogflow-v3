import type { TenantContext } from "@/core/tenant/resolve.server";
import { PICKER_LIMIT, searchProducts } from "@/core/catalog/picker";
import { getSettingsStrict } from "@/core/settings/settings";
import { CATALOG_KEY, snapshotOf } from "./pricelist/catalog.server";
import type { ConsultantProduct } from "./pricelist/catalog";
import { pricelistMode } from "./pricelist/mode";
import { foldText } from "./pricelist/synonyms";

/** Товар для привязки к публикации: id прайса или каталога, название, цена в тенге. */
export type StoryPickItem = { id: string; name: string; price: number | null };

/**
 * Поиск по прайсу: каждое слово запроса — в названии, категории, размере или
 * цвете. Порядок — название, затем id, без обрезки до поиска: новинки в конце
 * выгрузки 1С находятся так же, как первые строки.
 */
export function searchPricelist(
  rows: readonly ConsultantProduct[],
  q: string,
  limit = PICKER_LIMIT,
): StoryPickItem[] {
  const words = foldText(q).split(" ").filter(Boolean);
  const hits = rows.filter((p) => {
    if (!words.length) return true;
    const hay = foldText(`${p.name} ${p.category} ${p.size} ${p.colors.join(" ")}`);
    return words.every((w) => hay.includes(w));
  });
  return hits
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((p) => ({ id: p.id, name: p.name, price: p.price_kzt > 0 ? p.price_kzt : null }));
}

/**
 * Откуда выбирать товары публикации. Консультант «по прайсу» (BOVI) знает
 * только прайс 1С (`consultant_catalog_json`) — те же строки, что на вкладке
 * «Прайс консультанта». Каталог магазина (`products`) у такого клиента другой
 * и отстаёт от прайса: привязанный оттуда товар консультант искал в прайсе
 * лишь по похожему названию, а новинок из выгрузки в списке не было вовсе
 * (жалоба BOVI 29.09).
 */
export async function searchStoryProducts(
  ctx: TenantContext,
  q: string,
): Promise<{ source: "pricelist" | "catalog"; items: StoryPickItem[] }> {
  if (pricelistMode(ctx.tenant)) {
    // Мимо кэша консультанта и строго: только что загруженный прайс виден
    // сразу, а сбой чтения — ошибка, а не «ничего не найдено».
    const raw = (await getSettingsStrict(ctx, [CATALOG_KEY]))[CATALOG_KEY];
    return { source: "pricelist", items: searchPricelist(snapshotOf(raw).products, q) };
  }
  const found = await searchProducts(ctx, { q });
  return {
    source: "catalog",
    items: found.map((p) => ({ id: p.id, name: p.name, price: p.price > 0 ? p.price : null })),
  };
}
