import { AsyncLocalStorage } from "node:async_hooks";

/** Нормализация и синонимы домашнего текстиля — поиск не ломается на «полотенца». */

const YO = { ё: "е", Ё: "е" } as const;

export function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ёЁ]/g, (ch) => YO[ch as keyof typeof YO] ?? ch)
    .replace(/(\d)\s*[×хХx*∗]\s*(\d)/g, "$1x$2")
    .replace(/[^a-zа-я0-9x]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Словарь семантических синонимов и сокращений (кросс-языковые термины, аббревиатуры, сленг).
 * Падежи, числа и окончания русских слов (розовый/розового, полотенце/полотенец)
 * обрабатываются автоматически стеммером stemWord, их сюда вносить не нужно.
 */
const SYNONYM_GROUPS: string[][] = [
  // «полотенец» — родительный падеж множественного числа с беглой гласной:
  // стеммер окончаний его не берёт, а спрашивают им постоянно («стоимость
  // полотенец»). Поэтому вписано отдельным словом.
  ["полотенце", "полотенец", "towel"],
  ["банное", "bath"],
  ["махровое", "махра", "terry"],
  ["постельное", "bedding", "кпб"],
  ["наволочка", "pillowcase"],
  ["простыня", "sheet"],
  ["пододеяльник", "duvet"],
  ["матрас", "матрац", "mattress", "топпер"],
  ["одеяло", "blanket"],
  ["подушка", "pillow"],
  ["халат", "robe"],
  ["плед", "throw"],
  ["посуда", "dishes"],
  ["тарелка", "plate"],
  ["кружка", "чашка", "mug", "cup"],
  ["сатин", "sateen"],
  ["хлопок", "cotton"],
  ["евро", "eu", "euro"],
  ["семейный", "семейка", "дуэт"],
  ["полутораспальный", "полуторка", "полуторный", "1.5", "1,5", "1.5-спальный"],
  ["двуспальный", "двухспальный", "2-спальный", "double"],
];

const ADJ_ENDINGS_RE =
  /(?:ого|его|ому|ему|ыми|ими|ых|их|ую|юю|ая|яя|ое|ее|ый|ий|ым|им|ой|ей|ые|ие)$/;
const NOUN_ENDINGS_RE = /(?:ами|ями|ах|ях|ей|ов|ев|ом|ем|а|я|у|ю|е|о|ы|и)$/;

/**
 * Стеммер русских окончаний: отсекает падежные и родовые окончания.
 * Автоматически сводит любые грамматические формы слов («розового», «розовому», «розовые» → «розов»)
 * к единой основе для любых текущих и будущих товаров каталога без ручного ведения списков синонимов.
 */
export function stemWord(word: string): string {
  const w = foldText(word);
  if (w.length <= 3) return w;
  if (ADJ_ENDINGS_RE.test(w) && w.replace(ADJ_ENDINGS_RE, "").length >= 3) {
    return w.replace(ADJ_ENDINGS_RE, "");
  }
  if (NOUN_ENDINGS_RE.test(w) && w.replace(NOUN_ENDINGS_RE, "").length >= 3) {
    return w.replace(NOUN_ENDINGS_RE, "");
  }
  return w;
}

function buildLookup(groups: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    if (!group[0]) continue;
    const canon = foldText(group[0]);
    if (!canon) continue;
    for (const w of group) {
      const folded = foldText(w);
      if (!folded) continue;
      map.set(folded, canon);
      const stemmed = stemWord(folded);
      if (!map.has(stemmed)) map.set(stemmed, canon);
    }
  }
  return map;
}

/**
 * Одно слово — несколько товаров.
 *
 * «Португальские» — это и Bovi, и Graccioza; «итальянские» — Rivolta и
 * Dorelan; «немецкие» — Sander и Traumina. Сведение к одному бренду теряло бы
 * половину ответа, а объединение брендов в одну группу путало бы их между
 * собой: спросили Bovi — не должно приезжать Graccioza.
 *
 * Поэтому слово помнит ВСЕ группы, где встречается, и при подборе достаточно
 * совпадения с любой из них.
 */
function buildAlternatives(groups: string[][]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (key: string, canon: string) => {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [canon]);
    else if (!list.includes(canon)) list.push(canon);
  };
  for (const group of groups) {
    const canon = foldText(group[0] ?? "");
    if (!canon) continue;
    for (const w of group) {
      const folded = foldText(w);
      add(folded, canon);
      add(stemWord(folded), canon);
    }
  }
  return map;
}

const LOOKUP = buildLookup(SYNONYM_GROUPS);
const ALTERNATIVES = buildAlternatives(SYNONYM_GROUPS);

/**
 * Синонимы продавца поверх зашитых.
 *
 * Покупатель спросил «голландские полотенца» — бот ответил, что таких нет, а
 * это PIP Studio. Страна происхождения в прайсе не хранится вовсе, и знать её
 * коду неоткуда: «голландские — это PIP Studio», «итальянские — Dorelan» —
 * это сведения магазина, а не языка. Поэтому список ведёт продавец, а не мы
 * правкой кода на каждое новое слово.
 */
type Dynamic = { lookup: Map<string, string>; alts: Map<string, string[]> };
const NO_DYNAMIC: Dynamic = { lookup: new Map(), alts: new Map() };
/**
 * В v1 список продавца жил в глобальной переменной процесса — у v2 один
 * процесс на всех клиентов, поэтому список держится на время одного поиска
 * (AsyncLocalStorage) и чужой магазин его не видит.
 */
const scope = new AsyncLocalStorage<Dynamic>();
const dyn = () => scope.getStore() ?? NO_DYNAMIC;

export function compileSynonyms(groups: string[][]): Dynamic {
  return { lookup: buildLookup(groups), alts: buildAlternatives(groups) };
}

/** Выполнить поиск со списком синонимов магазина. */
export function withSynonyms<T>(groups: string[][] | Dynamic, fn: () => T): T {
  const d = Array.isArray(groups) ? compileSynonyms(groups) : groups;
  return scope.run(d, fn);
}

/**
 * Разбор списка из панели. Строка — одна группа: первое слово то, что реально
 * встречается в названиях товаров, остальные — как покупатель может спросить.
 *
 *   pip, голландские, голландия
 *   dorelan, итальянские, италия
 */
export function parseSynonymGroups(text: string): string[][] {
  return (text ?? "")
    .split("\n")
    .map((line) =>
      line
        .split(/[,;]/)
        .map((w) => w.trim())
        .filter(Boolean),
    )
    .filter((group) => group.length >= 2);
}

export function formatSynonymGroups(groups: string[][]): string {
  return groups.map((g) => g.join(", ")).join("\n");
}

export function expandToken(token: string): string {
  const folded = foldText(token);
  // Список продавца важнее зашитого: им же он и правит наши умолчания.
  const direct = dyn().lookup.get(folded) ?? LOOKUP.get(folded);
  if (direct) return direct;
  const stemmed = stemWord(folded);
  const fromStem = dyn().lookup.get(stemmed) ?? LOOKUP.get(stemmed);
  if (fromStem) return fromStem;
  return stemmed;
}

/**
 * Все значения слова — для подбора товара, где достаточно совпадения с любым.
 * Порядок: список продавца, затем зашитый, затем само слово.
 */
/**
 * Список магазина словами для промпта.
 *
 * Поиску синонимы помогают, а на вопрос «какие у вас португальские бренды?»
 * модель отвечает из своей памяти и ошибается: на живом диалоге назвала
 * португальским Castelbel, которого в списке продавца нет, и не назвала Bovi
 * с Graccioza, которые там как раз есть. Значит список должен быть у неё
 * перед глазами, а не только в подборе.
 */
export function formatSynonymsForPrompt(groups: string[][]): string {
  const lines = groups
    .filter((g) => g.length >= 2 && g[0]?.trim())
    .map(
      (g) =>
        `• ${g[0]!.trim()} — ${g
          .slice(1)
          .map((w) => w.trim())
          .filter(Boolean)
          .join(", ")}`,
    );
  if (lines.length === 0) return "";
  return [
    "МАРКИ И КАК ИХ НАЗЫВАЮТ ПОКУПАТЕЛИ",
    "Слева название из прайса, справа слова, которыми про него спрашивают (обычно страна производства).",
    "Это единственный источник страны: марки, которой здесь нет, страну НЕ приписывайте.",
    ...lines,
  ].join("\n");
}

export function expandTokenAll(token: string): string[] {
  const folded = foldText(token);
  const stemmed = stemWord(folded);
  const out: string[] = [];
  for (const map of [dyn().alts, ALTERNATIVES]) {
    for (const key of [folded, stemmed]) {
      for (const canon of map.get(key) ?? []) {
        if (!out.includes(canon)) out.push(canon);
      }
    }
  }
  if (out.length === 0) out.push(expandToken(token));
  return out;
}

export function tokenizeQuery(text: string): string[] {
  return foldText(text)
    .split(" ")
    .filter((t) => t.length > 1)
    .map(expandToken);
}

export function haystackOf(parts: string[]): string {
  return tokenizeQuery(parts.join(" ")).join(" ");
}
