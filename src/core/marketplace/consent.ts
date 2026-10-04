import { servedByV2 } from "@/core/tenant/directory";
import { VERTICALS } from "@/core/verticals/registry";
import type { Tenant } from "@/core/tenant/types";

/**
 * Участие магазина в площадке FrogFlow (путь В). Хранится в `bots.settings.marketplace`,
 * схема базы не меняется. Магазин участвует только по согласию продавца; решение
 * оператора («скрыть») сильнее согласия, а новый магазин виден после одобрения (В12).
 * Магазин клиента прежней платформы в площадке не участвует.
 */
export type MarketplaceState = "off" | "pending" | "hidden" | "visible";

type Shop = Pick<Tenant, "settings">;

/**
 * off — выключено продавцом или магазин не на v2; pending — продавец согласен,
 * оператор ещё не одобрил; hidden — оператор скрыл; visible — показываем.
 */
export function marketplaceState(t: Shop): MarketplaceState {
  if (!servedByV2(t)) return "off";
  const m = t.settings.marketplace;
  if (m?.hidden === true) return "hidden";
  if (m?.listed !== true) return "off";
  return m.approved === true ? "visible" : "pending";
}

export const shownOnMarketplace = (t: Shop): boolean => marketplaceState(t) === "visible";

/** Категория каталога: своя подпись продавца или ниша магазина. */
export function marketplaceCategory(t: Pick<Tenant, "settings" | "vertical">): string {
  return t.settings.marketplace?.category || VERTICALS[t.vertical]?.title || "";
}

export const marketplaceCity = (t: Shop): string => t.settings.marketplace?.city ?? "";
