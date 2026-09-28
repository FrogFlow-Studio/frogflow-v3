import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings, setSetting } from "@/core/settings/settings";

/**
 * Адрес, телефон и часы бутика для подсказки консультанта (перенос
 * consultant/store-info.ts v1): те же строки app_settings. Пусто — значения
 * BOVI по умолчанию, как в v1.
 */
export const STORE_ADDRESS_KEY = "consultant_store_address";
export const STORE_PHONE_KEY = "consultant_store_phone";
export const STORE_HOURS_KEY = "consultant_store_hours";

export const DEFAULT_STORE_ADDRESS = "г. Алматы, ул. Сатпаева, 3 (бутик-молл COLIBRI, 1-й этаж)";
export const DEFAULT_STORE_PHONE = "+7 (777) 333 08 08";
export const DEFAULT_STORE_HOURS = "ежедневно с 10:00 до 22:00";

export type StoreInfo = { address: string; phone: string; hours: string };

export async function getStoreInfo(ctx: TenantContext): Promise<StoreInfo> {
  const s = await getSettings(ctx, [
    STORE_ADDRESS_KEY,
    STORE_PHONE_KEY,
    STORE_HOURS_KEY,
    "admin_contact_link",
  ]);
  return {
    address: s[STORE_ADDRESS_KEY]?.trim() || DEFAULT_STORE_ADDRESS,
    phone: s[STORE_PHONE_KEY]?.trim() || s.admin_contact_link?.trim() || DEFAULT_STORE_PHONE,
    hours: s[STORE_HOURS_KEY]?.trim() || DEFAULT_STORE_HOURS,
  };
}

export async function saveStoreInfo(ctx: TenantContext, info: Partial<StoreInfo>): Promise<void> {
  if (typeof info.address === "string")
    await setSetting(ctx, STORE_ADDRESS_KEY, info.address.trim());
  if (typeof info.phone === "string") await setSetting(ctx, STORE_PHONE_KEY, info.phone.trim());
  if (typeof info.hours === "string") await setSetting(ctx, STORE_HOURS_KEY, info.hours.trim());
}
