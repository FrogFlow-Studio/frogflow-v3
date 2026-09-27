import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";

/**
 * Все товары в продаже, постранично: у крупного магазина их больше 1000, а
 * PostgREST молча отдаёт только первую тысячу. Для подбора квиза и
 * сопоставления корзины из каталога Meta, где нужен весь ассортимент.
 */
export async function allActiveProducts<T extends { id: string }>(
  ctx: TenantContext,
  columns: string,
): Promise<T[]> {
  return pageAll<T>(
    (from, to) =>
      ctx.db
        .from("products")
        .select(columns)
        .eq("is_active", true)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>,
    "товары в продаже",
  );
}
