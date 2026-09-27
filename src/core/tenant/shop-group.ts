import { availableModules } from "@/core/modules/registry";
import { servedByV2 } from "./directory";
import type { Tenant } from "./types";

/**
 * Модуль «Несколько ботов»: один продавец — несколько магазинов (отдельные
 * записи `bots`, у каждого свои товары, заказы, покупатели и настройки), вход
 * один. Связь — `settings.multi_bot.group`, одинаковая у всех магазинов
 * продавца; ставит её только оператор, поэтому «привязать чужой магазин»
 * продавцу нечем. Изоляция данных остаётся прежней: админка в каждый момент
 * работает с одним магазином под его ключом арендатора.
 */
export function shopGroup(t: Pick<Tenant, "settings">): string | null {
  return t.settings.multi_bot?.group ?? null;
}

/** Модуль действует: включён оператором и готов (planned-флаг ничего не открывает). */
export function multiBotOn(t: Pick<Tenant, "modules">): boolean {
  return availableModules(t.modules).multi_bot;
}

/** Магазин, в котором сейчас можно работать из группы: на v2, не в архиве, с модулем. */
function usable(t: Tenant): boolean {
  return !t.archived && servedByV2(t) && multiBotOn(t);
}

/**
 * Можно ли из магазина `home` (где лежит логин продавца) работать в `target`.
 * Оба в одной непустой группе, у обоих действует модуль, target — на v2.
 */
export function canSwitchShop(home: Tenant, target: Tenant): boolean {
  if (home.id === target.id) return true;
  const g = shopGroup(home);
  return Boolean(g) && g === shopGroup(target) && usable(home) && usable(target);
}

/** Магазины группы, доступные владельцу `home`, — сам home первым, дальше по названию. */
export function groupShops(dir: readonly Tenant[], home: Tenant): Tenant[] {
  const others = dir
    .filter((t) => t.id !== home.id && canSwitchShop(home, t))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return others.length ? [home, ...others] : [home];
}
