import { createServerFn } from "@tanstack/react-start";

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/**
 * Куда вести покупателей (Р5): бот и витрина магазина. Тот же расчёт, что у
 * генератора ссылок в аналитике: бот — если подключён, витрина — если у
 * магазина есть адрес и каталог открыт.
 */
export const shareFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { storefrontOpen } = await import("@/core/storefront/access");
  const { storefrontBase } = await import("@/core/tenant/custom-domain");
  const { getSetting } = await import("@/core/settings/settings");
  return {
    shopName: (await getSetting(ctx, "shop_name")) || ctx.tenant.name,
    bot: ctx.tenant.telegramTokenEnc ? (ctx.tenant.settings.telegram?.username ?? null) : null,
    store:
      ctx.tenant.settings.slug && storefrontOpen(ctx.tenant, "catalog")
        ? storefrontBase(ctx.tenant, ctx.appUrl)
        : null,
  };
});
