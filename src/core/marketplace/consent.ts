import { storefrontAllows } from "@/core/storefront/access";
import { servedByV2 } from "@/core/tenant/directory";
import { VERTICALS } from "@/core/verticals/registry";
import type { Tenant } from "@/core/tenant/types";

/**
 * Участие магазина в площадке FrogFlow (путь В). Хранится в `bots.settings.marketplace`,
 * схема базы не меняется. Магазин участвует только по согласию продавца; решение
 * оператора («скрыть») сильнее согласия, а новый магазин виден после одобрения (В12).
 * Магазин клиента прежней платформы в площадке не участвует.
 */
export type MarketplaceState = "off" | "pending" | "hidden" | "no_catalog" | "visible";

type Shop = Pick<Tenant, "settings" | "modules">;

/**
 * off — выключено продавцом или магазин не на v2; pending — продавец согласен,
 * оператор ещё не одобрил; hidden — оператор скрыл; no_catalog — согласие и одобрение
 * есть, но каталог витрины закрыт (нет модуля витрины или Mini App): ссылка с площадки
 * вела бы в 404, поэтому магазин не показываем; visible — показываем.
 */
export function marketplaceState(t: Shop): MarketplaceState {
  if (!servedByV2(t)) return "off";
  const m = t.settings.marketplace;
  if (m?.hidden === true) return "hidden";
  if (m?.listed !== true) return "off";
  if (m.approved !== true) return "pending";
  return storefrontAllows(t.modules, "catalog") ? "visible" : "no_catalog";
}

export const shownOnMarketplace = (t: Shop): boolean => marketplaceState(t) === "visible";

/** Категория каталога: своя подпись продавца или ниша магазина. */
export function marketplaceCategory(t: Pick<Tenant, "settings" | "vertical">): string {
  return t.settings.marketplace?.category || VERTICALS[t.vertical]?.title || "";
}

export const marketplaceCity = (t: Shop): string => t.settings.marketplace?.city ?? "";
