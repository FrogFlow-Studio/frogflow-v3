import type { TenantContext } from "@/core/tenant/resolve.server";
import { sellsInBot } from "@/core/tenant/preflight";
import { isConsultantVertical } from "@/core/verticals/registry";
import { serverFailure } from "@/lib/server-failure";

/**
 * Продаёт ли клиент сейчас (`sellsInBot` по живому числу включённых товаров).
 * Магазин любой ниши — да, без запроса в базу. Консультант (BOVI) — только с
 * курсами или с модулем продажи и включёнными товарами: модуль магазина у
 * консультанта v1 часто включён, а продавать нечего. Тогда бот не ведёт
 * покупателя в пустой каталог, а админка не просит товары, оплату и доставку.
 * Сбой чтения — ошибка: вызывающий решает, что показать.
 */
export async function sellsNow(ctx: TenantContext): Promise<boolean> {
  const t = ctx.tenant;
  if (!isConsultantVertical(t.vertical) || t.modules.courses) return true;
  if (!sellsInBot(t, 1)) return false;
  const { count, error } = await ctx.db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (error) throw serverFailure(`Продаёт ли клиент: ${error.message}`);
  return sellsInBot(t, count ?? 0);
}

/** То же для бота: сбой чтения — как раньше, магазин (покупатель не остаётся без ответа). */
export async function sellsNowOrShop(ctx: TenantContext): Promise<boolean> {
  try {
    return await sellsNow(ctx);
  } catch (e) {
    console.error(`[sells:${ctx.tenant.id}]`, e instanceof Error ? e.message : e);
    return true;
  }
}
