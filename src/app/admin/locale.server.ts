import type { TenantContext } from "@/core/tenant/resolve.server";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { adminT, type AdminT } from "@/app/i18n/admin";

/** Язык админки продавца: app_settings.admin_locale, иначе язык магазина, иначе русский. */
export async function adminLocale(ctx: TenantContext): Promise<Locale> {
  const { getSettings } = await import("@/core/settings/settings");
  const st = await getSettings(ctx, ["admin_locale"]);
  return isLocale(st.admin_locale) ? st.admin_locale : (ctx.tenant.settings.default_locale ?? "ru");
}

/** Переводчик на язык админки — для сообщений, которые сервер отдаёт продавцу. */
export async function adminTFor(ctx: TenantContext): Promise<AdminT> {
  return adminT(await adminLocale(ctx));
}
