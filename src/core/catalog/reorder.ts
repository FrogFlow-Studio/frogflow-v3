import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Порядок перетаскиванием (каталог и категории): список id в новом порядке
 * получает sort_order по возрастанию с шагом 10, начиная с `start`. Товары
 * показываются страницами — страница нумеруется от своего наименьшего
 * sort_order, чтобы не перемешаться с соседними.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
    return [...list];
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

export function sortOrders(ids: readonly string[], start: number): Array<[string, number]> {
  return ids.map((id, i) => [id, start + i * 10]);
}

export async function applyOrder(
  ctx: TenantContext,
  table: "products" | "categories",
  ids: readonly string[],
  start = 10,
): Promise<void> {
  for (const [id, sort_order] of sortOrders(ids, start)) {
    const { error } = await ctx.db.from(table).update({ sort_order }).eq("id", id);
    if (error) throw new Error(`${table} sort_order: ${error.message}`);
  }
}
