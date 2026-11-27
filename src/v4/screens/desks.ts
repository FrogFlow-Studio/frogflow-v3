/**
 * Восемь рабочих мест v4 и общие страницы. Каждая страница админки и
 * оператора v3 приписана к месту. Незнакомый файл — пустая клетка: тест
 * падает, пока страницу явно не разложат.
 */

export const DESKS = [
  "today",
  "catalog",
  "buyers",
  "school",
  "warehouse",
  "broadcast",
  "shop",
  "operator",
  "shared",
] as const;

export type Desk = (typeof DESKS)[number];

const SHARED = new Set([
  "admin.tsx",
  "admin._authed.tsx",
  "admin.login.tsx",
  "admin.tg-login.tsx",
  "admin.invite.tsx",
  "admin.print.$id.tsx",
  "admin.print-batch.tsx",
  "admin.packing.$id.tsx",
  "admin._authed.help.tsx",
  "admin._authed.help_.$section.tsx",
  "admin._authed.locked.$module.tsx",
  "operator.tsx",
  "operator._authed.tsx",
  "operator.login.tsx",
]);

function named(file: string, words: string[]): boolean {
  return words.some((w) => file.includes(`.${w}.`) || file.includes(`.${w}_`));
}

/** Куда относится файл маршрута. null — страница ещё не разложена. */
export function deskOf(file: string): Desk | null {
  const name = file.replace(/^.*\//, "");
  if (SHARED.has(name)) return "shared";
  if (name.startsWith("operator.")) return "operator";
  if (name.includes(".warehouse.")) return "warehouse";
  if (named(name, ["products", "pricelist", "media", "discounts", "collections", "categories"]))
    return "catalog";
  if (named(name, ["reviews", "customers"])) return "buyers";
  if (named(name, ["students", "quiz", "homework", "community", "vip"])) return "school";
  if (named(name, ["share", "posts", "news", "instagram", "ig-import", "broadcasts"]))
    return "broadcast";
  if (
    named(name, [
      "v4-seller",
      "settings",
      "modules",
      "log",
      "knowledge",
      "consultant",
      "bot-preview",
      "bot-texts",
      "billing",
      "ai-balance",
    ])
  )
    return "shop";
  if (name.startsWith("admin.")) return "today";
  return null;
}
