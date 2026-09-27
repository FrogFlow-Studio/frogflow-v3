/**
 * Ссылки с меткой для воронки по источникам (core/analytics/source-funnel):
 * продавец вводит метку («весна», «блогер Анна»), получает ссылку на бота
 * `t.me/<бот>?start=src_<метка>` и адрес витрины `?utm_source=<метка>`.
 * Бот пишет payload /start в state.first_source, витрина — `site:<метка>`
 * (core/storefront/web-source); воронка сводит обе в одну строку метки.
 * Метки на «ref-» заняты: витрина читает их как приглашение друга.
 *
 * Telegram принимает в start только латиницу, цифры, `_` и `-` (до 64
 * знаков), витрина — до 40 знаков в utm_source. Поэтому кириллица
 * (русская и казахская) переводится в латиницу, пробелы — в `_`, а всё, что
 * перевести нельзя, не принимается с понятной причиной.
 *
 * Модуль без базы: его читают страница аналитики и тесты.
 */

export const SOURCE_LINK_PREFIX = "src_";
/** Не длиннее utm_source витрины — одна метка годится для обеих ссылок. */
export const SOURCE_TAG_MAX = 40;

const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  // казахские буквы
  ә: "a",
  ғ: "g",
  қ: "q",
  ң: "n",
  ө: "o",
  ұ: "u",
  ү: "u",
  һ: "h",
  і: "i",
  // узбекские буквы
  ў: "o",
  ҳ: "h",
};

export type SourceTag =
  { ok: true; tag: string } | { ok: false; reason: "empty" | "chars" | "long" | "reserved" };

/**
 * Метка из того, что ввёл продавец: латиница в нижнем регистре, цифры, `_`
 * и `-`. Кириллица переводится, пробелы и точки становятся `_`.
 */
export function sourceTag(input: string): SourceTag {
  const lower = input.trim().toLowerCase();
  if (!lower) return { ok: false, reason: "empty" };
  let out = "";
  for (const ch of lower) {
    if (/[a-z0-9_-]/.test(ch)) out += ch;
    else if (ch in CYRILLIC) out += CYRILLIC[ch];
    else if (/[\s.]/.test(ch)) out += "_";
    else return { ok: false, reason: "chars" };
  }
  const tag = out.replace(/_+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  if (!tag) return { ok: false, reason: "empty" };
  if (tag.length > SOURCE_TAG_MAX) return { ok: false, reason: "long" };
  if (tag.startsWith("ref-")) return { ok: false, reason: "reserved" };
  return { ok: true, tag };
}

/** Ссылка на бота: `https://t.me/<бот>?start=src_<метка>`. */
export function botSourceLink(bot: string, tag: string): string {
  return `https://t.me/${bot.replace(/^@/, "")}?start=${SOURCE_LINK_PREFIX}${tag}`;
}

/** Адрес витрины с меткой: `<витрина>?utm_source=<метка>`. */
export function storeSourceLink(store: string, tag: string): string {
  return `${store}${store.includes("?") ? "&" : "?"}utm_source=${tag}`;
}
