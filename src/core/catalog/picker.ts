import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Выбор товара в формах админки (рассылки, предложения, допродажа, сторис):
 * поиск по названию, а не весь каталог в выпадающем списке. У крупного
 * магазина сотни товаров, и список «первые 200/500» молча терял остальные.
 */
export const PICKER_LIMIT = 30;

export type PickerProduct = { id: string; name: string; price: number; currency: string };

/** Строка поиска для ilike: без подстановочных знаков и символов синтаксиса фильтров. */
export function pickerTerm(q: string): string {
  return q
    .replace(/[%_,()*\\]/g, " ")
    .trim()
    .slice(0, 100);
}

const toPicker = (p: { id: string; name: string; price: unknown; currency: string }) => ({
  id: p.id,
  name: p.name,
  price: Number(p.price),
  currency: p.currency,
});

/** Активные товары по названию, не больше limit; порядок — название, затем id. */
export async function searchProducts(
  ctx: TenantContext,
  opts: { q?: string; exclude?: readonly string[]; limit?: number } = {},
): Promise<PickerProduct[]> {
  const limit = Math.min(Math.max(opts.limit ?? PICKER_LIMIT, 1), 100);
  const exclude = new Set(opts.exclude ?? []);
  let q = ctx.db.from("products").select("id, name, price, currency").eq("is_active", true);
  const term = pickerTerm(opts.q ?? "");
  if (term) q = q.ilike("name", `%${term}%`);
  // Исключённых немного (выбранные в форме) — добираем их число сверху и отсекаем здесь.
  const { data, error } = await q
    .order("name")
    .order("id")
    .limit(limit + exclude.size);
  if (error) throw new Error(`products: ${error.message}`);
  return (data ?? [])
    .filter((p) => !exclude.has(p.id))
    .slice(0, limit)
    .map(toPicker);
}

/** Названия уже выбранных товаров (в том числе скрытых) — для подписей в форме. */
export async function productsByIds(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<PickerProduct[]> {
  const unique = [...new Set(ids)];
  const out: PickerProduct[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await ctx.db
      .from("products")
      .select("id, name, price, currency")
      .in("id", unique.slice(i, i + 100));
    if (error) throw new Error(`products: ${error.message}`);
    out.push(...(data ?? []).map(toPicker));
  }
  return out;
}
