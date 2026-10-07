/**
 * Какие модули показывать на странице «Модули». Консультанту без продаж
 * (`sells === false`, BOVI) не предлагаем подключить оплату, витрину, склад и
 * доставку: продавать ему нечего. Уже включённые модули видны — продавец
 * видит, что у него есть. Нет `sells` — продаёт, показываем всё.
 */
import type { ModuleKey } from "@/core/modules/registry";

/** Модули, которые работают только с заказами и товарами. */
export const SELLING_MODULES: ReadonlySet<ModuleKey> = new Set<ModuleKey>([
  "robokassa",
  "crypto",
  "stripe",
  "kaspi_pay",
  "receipt_ocr",
  "telegram_stars",
  "coupons",
  "gift_certificates",
  "upsell",
  "multi_currency",
  "smart_search",
  "web_storefront",
  "telegram_mini_app",
  "stock",
  "warehouse",
  "limited_offers",
  "waitlist",
  "courier",
  "bundles",
]);

export function moduleOffered(
  key: ModuleKey,
  shop: { modules: Partial<Record<string, boolean>>; sells?: boolean },
): boolean {
  if (shop.sells !== false || shop.modules[key]) return true;
  return !SELLING_MODULES.has(key);
}
