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

/** Что записать в `settings.multi_bot` магазинам: группа или null («отвязан»). */
export type GroupChange = { botId: string; group: string | null };

/**
 * Связать два магазина. Группа — уже существующая у одного из них, иначе
 * новая — `newGroup` (оператор передаёт свежий uuid). Два магазина из разных
 * групп не сливаем: оператор сначала отвязывает, чтобы случайно не открыть
 * одному продавцу магазины другого.
 */
export function planLink(
  a: Pick<Tenant, "id" | "settings">,
  b: Pick<Tenant, "id" | "settings">,
  newGroup: string,
): { changes: GroupChange[] } | { error: string } {
  if (a.id === b.id) return { error: "Магазин нельзя связать с самим собой." };
  const ga = shopGroup(a);
  const gb = shopGroup(b);
  if (ga && gb && ga !== gb)
    return { error: "Оба магазина уже связаны с другими магазинами — сначала отвяжите один." };
  const group = ga ?? gb ?? newGroup.toLowerCase();
  return {
    changes: [a, b].filter((t) => shopGroup(t) !== group).map((t) => ({ botId: t.id, group })),
  };
}

/**
 * Отвязать магазин от группы. Если в группе остаётся один магазин, отвязываем
 * и его: группа из одного магазина ничего не значит и только мешает связать
 * его заново с другим.
 */
export function planUnlink(
  dir: readonly Pick<Tenant, "id" | "settings">[],
  t: Pick<Tenant, "id" | "settings">,
): GroupChange[] {
  const g = shopGroup(t);
  if (!g) return [];
  const members = dir.filter((x) => shopGroup(x) === g);
  const rest = members.filter((x) => x.id !== t.id);
  return (rest.length <= 1 ? [t, ...rest] : [t]).map((x) => ({ botId: x.id, group: null }));
}
