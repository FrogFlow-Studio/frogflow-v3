import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { eachPage } from "@/core/db/page";
import { getSettingStrict } from "@/core/settings/settings";
import { OFFERS_KEY, parseOffers, type LimitedOffer } from "@/core/offers/offers";
import {
  saleVerdict,
  saleWindows,
  sellThrough,
  type SaleLine,
  type SaleOrder,
  type SaleResult,
} from "./sales";

/** Акции, начатые за последние 90 дней и ещё идущие, — со списком по новизне. */
export const SALES_HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;

/** Название для таблицы: своё название акции, иначе товар или «категория». */
async function offerName(ctx: TenantContext, o: LimitedOffer): Promise<string> {
  const { data, error } = o.category_id
    ? await ctx.db.from("categories").select("name").eq("id", o.category_id).maybeSingle()
    : await ctx.db.from("products").select("name").eq("id", o.product_id).maybeSingle();
  if (error) throw serverFailure(`Итоги акции, название: ${error.message}`);
  const name = data?.name ?? "—";
  return o.category_id ? `«${name}»` : name;
}

export async function saleResults(ctx: TenantContext, now = new Date()): Promise<SaleResult[]> {
  if (!ctx.tenant.modules.limited_offers) return [];
  const since = now.getTime() - SALES_HISTORY_DAYS * DAY_MS;
  const offers = parseOffers(await getSettingStrict(ctx, OFFERS_KEY))
    .filter((o) => Date.parse(o.starts_at) <= now.getTime() && Date.parse(o.ends_at) > since)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  if (offers.length === 0) return [];

  // Товары категорийных акций — одним чтением каталога (постранично).
  const categories = new Set(offers.map((o) => o.category_id).filter((c): c is string => !!c));
  const byCategory = new Map<string, Set<string>>();
  if (categories.size) {
    await eachPage<{ id: string; category_ids: unknown }>(
      (a, b) => ctx.db.from("products").select("id, category_ids").order("id").range(a, b),
      "акции: товары категорий",
      (rows) => {
        for (const p of rows)
          for (const c of Array.isArray(p.category_ids) ? p.category_ids : [])
            if (typeof c === "string" && categories.has(c)) {
              const set = byCategory.get(c) ?? new Set<string>();
              set.add(p.id);
              byCategory.set(c, set);
            }
      },
    );
  }

  // Заказы от начала самого раннего «до» и их позиции — по диапазону номеров заказов.
  const from = Math.min(...offers.map((o) => saleWindows(o, now).beforeStart));
  const orders = new Map<number, SaleOrder>();
  await eachPage<SaleOrder>(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, created_at, status, currency, fulfillment_kind")
        .gte("created_at", new Date(from).toISOString())
        .lt("created_at", now.toISOString())
        .order("id")
        .range(a, b),
    "акции: заказы",
    (rows) => {
      for (const o of rows) orders.set(Number(o.id), o);
    },
  );
  const lines: SaleLine[] = [];
  if (orders.size) {
    const ids = [...orders.keys()];
    const lo = Math.min(...ids);
    const hi = Math.max(...ids);
    await eachPage<SaleLine & { id: string }>(
      (a, b) =>
        ctx.db
          .from("order_items")
          .select("id, order_id, product_id, quantity, price_snapshot")
          .gte("order_id", lo)
          .lte("order_id", hi)
          .order("id")
          .range(a, b),
      "акции: позиции заказов",
      (rows) => {
        for (const l of rows) if (orders.has(Number(l.order_id))) lines.push(l);
      },
    );
  }

  const out: SaleResult[] = [];
  for (const o of offers) {
    const products = o.category_id
      ? (byCategory.get(o.category_id) ?? new Set<string>())
      : new Set([o.product_id]);
    const { during, before } = sellThrough(o, products, orders, lines, now);
    const name = o.title?.trim() || (await offerName(ctx, o));
    out.push({
      id: o.id,
      name,
      percent: o.percent,
      startsAt: o.starts_at,
      endsAt: o.ends_at,
      running: Date.parse(o.ends_at) > now.getTime(),
      during,
      before,
      verdict: saleVerdict(during, before),
    });
  }
  return out;
}
