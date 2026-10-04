import type { Tenant } from "@/core/tenant/types";
import { shownInCommunity } from "./profile";

/**
 * Взаимные рекомендации магазинов (С6). Автор называет до RECOMMEND_MAX магазинов; на витрине и на
 * странице автора рекомендация видна, только когда рекомендуют друг друга оба и оба сейчас
 * показываются в сообществе. Отозвал согласие (убрал из списка, выключил сообщество, скрыт
 * оператором) — рекомендация исчезает сама: ничего отдельно не храним и не чистим.
 */
export const RECOMMEND_MAX = 5;

type T = Pick<Tenant, "id" | "settings">;

/** Чистый список: только строки-id, без повторов и без себя, не больше RECOMMEND_MAX. */
export function cleanRecommend(raw: unknown, selfId: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || x === selfId || out.includes(x)) continue;
    out.push(x);
    if (out.length >= RECOMMEND_MAX) break;
  }
  return out;
}

export const recommends = (a: T, b: T): boolean =>
  (a.settings.community_recommend ?? []).includes(b.id);

/** Магазины, с которыми у `me` взаимная рекомендация; порядок — как в списке `me`. */
export function mutualRecommendations<X extends T>(me: T, all: X[]): X[] {
  if (!shownInCommunity(me)) return [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const out: X[] = [];
  for (const id of cleanRecommend(me.settings.community_recommend, me.id)) {
    const other = byId.get(id);
    if (other && shownInCommunity(other) && recommends(other, me)) out.push(other);
  }
  return out;
}
