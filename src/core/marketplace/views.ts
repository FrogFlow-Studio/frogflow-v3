/**
 * «Недавно смотрели» на площадке (Л2): список открытых товаров лежит только в браузере
 * покупателя (localStorage), сервер его не хранит и в базу ничего не пишет. Последний открытый
 * товар первый; повтор переезжает наверх, а не дублируется.
 */
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

export const MARKET_RECENT_KEY = "ff_market_recent";
export const MARKET_RECENT_MAX = 12;

export type View = { slug: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const valid = (v: unknown): v is View =>
  !!v &&
  typeof v === "object" &&
  typeof (v as View).slug === "string" &&
  typeof (v as View).id === "string" &&
  SHOP_SLUG_RE.test((v as View).slug) &&
  UUID.test((v as View).id);

export function parseViews(raw: string | null | undefined): View[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: View[] = [];
    for (const v of data)
      if (valid(v) && !out.some((x) => x.id === v.id)) out.push({ slug: v.slug, id: v.id });
    return out.slice(0, MARKET_RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushView(list: readonly View[], view: View): View[] {
  if (!valid(view)) return [...list];
  return [view, ...list.filter((x) => x.id !== view.id)].slice(0, MARKET_RECENT_MAX);
}
