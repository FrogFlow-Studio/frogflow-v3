import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Апсейл и кросс-сейл (модуль upsell): в корзине — «С этим берут» до трёх
 * товаров. Источник — правила продавца «товар → что предлагать»
 * (`app_settings.upsell_rules`, JSON `{productId: [ids]}`); если правил для
 * корзины нет — популярные товары из тех же категорий. Предлагаем только то,
 * что в продаже, есть на складе и ещё не в корзине.
 */
export const UPSELL_KEY = "upsell_rules";
export const UPSELL_MAX = 3;

export type UpsellRules = Record<string, string[]>;

export function parseRules(raw: string | null | undefined): UpsellRules {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: UpsellRules = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>))
      if (Array.isArray(v))
        out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 10);
    return out;
  } catch {
    return {};
  }
}

/** Кандидаты из правил: по порядку товаров корзины, без повторов и без того, что уже в корзине. */
export function fromRules(
  cartIds: readonly string[],
  rules: UpsellRules,
  limit = UPSELL_MAX,
): string[] {
  const inCart = new Set(cartIds);
  const out: string[] = [];
  for (const id of cartIds)
    for (const s of rules[id] ?? [])
      if (!inCart.has(s) && !out.includes(s)) {
        out.push(s);
        if (out.length >= limit) return out;
      }
  return out;
}

export type UpsellProduct = { id: string; name: string; price: number; currency: string };

type Row = {
  id: string;
  name: string;
  price: number;
  currency: string;
  category_ids: unknown;
  stock_quantity: number | null;
  rating_count: number | null;
  fulfillment_kind: string;
};

export async function upsellFor(
  ctx: TenantContext,
  cartIds: readonly string[],
  limit = UPSELL_MAX,
): Promise<UpsellProduct[]> {
  if (!ctx.tenant.modules.upsell || cartIds.length === 0) return [];
  const rules = parseRules(await getSetting(ctx, UPSELL_KEY));
  const { data } = await ctx.db
    .from("products")
    .select(
      "id, name, price, currency, category_ids, stock_quantity, rating_count, fulfillment_kind",
    )
    .eq("is_active", true)
    .limit(500);
  const rows = (data ?? []) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const inCart = new Set(cartIds);
  const stockOn = ctx.tenant.modules.stock;
  const kinds = new Set(cartIds.map((id) => byId.get(id)?.fulfillment_kind).filter(Boolean));
  const ok = (r: Row | undefined): r is Row =>
    Boolean(r) &&
    !inCart.has(r!.id) &&
    !(stockOn && r!.stock_quantity != null && r!.stock_quantity <= 0) &&
    // Цифровое и физическое оформляются отдельно — не предлагаем смешать корзину.
    (kinds.size === 0 || kinds.has(r!.fulfillment_kind));
  const picked = fromRules(cartIds, rules, 20)
    .map((id) => byId.get(id))
    .filter(ok);
  if (picked.length < limit) {
    const cats = new Set(
      cartIds.flatMap((id) => {
        const c = byId.get(id)?.category_ids;
        return Array.isArray(c) ? (c as string[]) : [];
      }),
    );
    const same = rows
      .filter(
        (r) =>
          ok(r) &&
          !picked.some((p) => p.id === r.id) &&
          Array.isArray(r.category_ids) &&
          (r.category_ids as string[]).some((c) => cats.has(c)),
      )
      .sort((a, b) => (b.rating_count ?? 0) - (a.rating_count ?? 0));
    picked.push(...same);
  }
  return picked.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    currency: r.currency,
  }));
}

export async function getUpsellFor(ctx: TenantContext, productId: string): Promise<string[]> {
  return parseRules(await getSetting(ctx, UPSELL_KEY))[productId] ?? [];
}

export async function setUpsellFor(
  ctx: TenantContext,
  productId: string,
  ids: string[],
): Promise<void> {
  const rules = parseRules(await getSetting(ctx, UPSELL_KEY));
  const clean = Array.from(new Set(ids.filter((x) => x !== productId))).slice(0, 10);
  if (clean.length) rules[productId] = clean;
  else delete rules[productId];
  await setSetting(ctx, UPSELL_KEY, JSON.stringify(rules));
}
