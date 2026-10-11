/**
 * Покупатель отвечает на список разделов названием, а не номером. Продавцы
 * называют разделы с эмодзи, скобками и капсом («🏫НАЧАЛЬНАЯ ШКОЛА (1-4
 * классы)»), а покупатель пишет «Начальная школа» или «Категоря начальная
 * школа» (AATeach, 11.10). Модуль чистый: только сравнение строк.
 */

/** Слова-обёртки вокруг названия: «раздел начальная школа», «покажите категорию …». */
const FILLER = new Set([
  "раздел",
  "раздела",
  "разделе",
  "категория",
  "категорию",
  "категории",
  "категоря",
  "каталог",
  "покажите",
  "покажи",
  "открой",
  "откройте",
  "хочу",
  "нужно",
  "нужна",
  "нужен",
  "пожалуйста",
  "мне",
]);

/**
 * Слова названия: без эмодзи, скобок с содержимым, номера пункта («4. Русоведам»),
 * знаков и регистра. «1 сентября» без точки — это название, номер остаётся.
 */
export function sectionWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/^\s*\d{1,3}\s*[.)]\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Одно слово в разных падежах: «школа» и «школу», «хлеб» и «хлеба», «начальная»
 * и «начальную». Расходиться может окончание: одна буква у коротких слов, две у
 * длинных.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 4 || Math.abs(a.length - b.length) > 2) return false;
  let i = 0;
  while (i < short && a[i] === b[i]) i++;
  return i >= short - (short >= 6 ? 2 : 1);
}

/** Все слова `part` есть в `whole`. */
function covers(whole: string[], part: string[]): boolean {
  return part.length > 0 && part.every((w) => whole.some((x) => sameWord(x, w)));
}

export interface SectionMatch {
  id: string;
  /**
   * Покупатель написал название слово в слово (без учёта эмодзи, скобок,
   * регистра и слов «раздел», «категория»). Неточное совпадение — другой
   * падеж, лишние слова, часть названия («Хлеба» для «День ХЛЕБА») —
   * уступает кодовым словам правил: «Папка профориентатора» остаётся правилом,
   * хотя в списке есть раздел «Папки».
   */
  exact: boolean;
}

/**
 * Раздел из показанного списка по тексту покупателя, иначе null. Сначала
 * слово в слово; потом текст содержит все слова названия (с падежами);
 * потом текст — часть названия. На каждой ступени нужен ровно один раздел:
 * «День» подходит к десятку разделов и не открывает ни одного.
 */
export function matchSectionName(
  text: string,
  sections: ReadonlyArray<{ id: string; name: string }>,
): SectionMatch | null {
  const said = sectionWords(text);
  const core = said.filter((w) => !FILLER.has(w));
  if (core.join(" ").length < 3) return null;
  const named = sections
    .map((s) => ({ id: s.id, words: sectionWords(s.name) }))
    .filter((s) => s.words.length > 0);
  const one = (found: Array<{ id: string }>) =>
    new Set(found.map((s) => s.id)).size === 1 ? found[0]!.id : null;

  const key = core.join(" ");
  const exact = named.filter((s) => s.words.join(" ") === key);
  if (exact.length) {
    const id = one(exact);
    return id ? { id, exact: true } : null;
  }
  // Другой падеж («начальную школу») или название внутри текста («Начальная
  // школа 2 класс»). Длинное название важнее короткого: «Математика и логика»
  // поглощает «Математика».
  const inText = named.filter((s) => covers(said, s.words));
  if (inText.length) {
    const longest = Math.max(...inText.map((s) => s.words.length));
    const id = one(inText.filter((s) => s.words.length === longest));
    return id ? { id, exact: false } : null;
  }
  // «Хлеба», «Грамоты» — часть названия; короткие слова («1», «и») не в счёт.
  if (!core.some((w) => w.length >= 4)) return null;
  const id = one(named.filter((s) => covers(s.words, core)));
  return id ? { id, exact: false } : null;
}
