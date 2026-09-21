import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { MATERIAL_LANGUAGES, materialLanguages } from "@/core/catalog/materials";
import { listCart } from "./cart";
import type { Locale } from "@/core/i18n/locale";

/**
 * Когда спрашивать язык материалов (модуль multi_language): «before» — до
 * оформления, с ценой ×N за «все языки»; иначе — при выдаче, кнопкой на
 * каждую позицию (Telegram) или всеми языками сразу (Direct, письмо).
 */
export async function askDeliveryLangBeforeOrder(ctx: TenantContext): Promise<boolean> {
  if (!ctx.tenant.modules.multi_language) return false;
  return (await getSetting(ctx, "delivery_lang_timing")) === "before";
}

/** Языки, реально доступные хоть у одного цифрового товара в корзине. */
export async function cartLanguageChoices(
  ctx: TenantContext,
  customer: Customer,
): Promise<Locale[]> {
  const set = new Set<Locale>();
  for (const it of await listCart(ctx, customer)) {
    if (!it.products || it.products.fulfillment_kind === "physical") continue;
    for (const l of materialLanguages(it.products)) set.add(l);
  }
  return MATERIAL_LANGUAGES.filter((l) => set.has(l));
}
