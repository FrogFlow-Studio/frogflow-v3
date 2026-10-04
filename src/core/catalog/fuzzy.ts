/**
 * Поиск с опечатками — чистая часть, без базы. Слово запроса совпадает со
 * словом товара, если они равны, одно начинается с другого (от 3 знаков) или
 * различаются на одну правку: вставка, пропуск, замена, перестановка соседних
 * букв. Слова короче 4 знаков — только точно: на них «одна правка» ловит мусор.
 */

export type FuzzyItem = { id: string; text: string };

export const FUZZY_MIN_WORD = 4;

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Не больше одной правки (расстояние Дамерау — Левенштейна ≤ 1). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // замена
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // перестановка
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

function wordMatches(q: string, w: string): boolean {
  if (q === w) return true;
  if (q.length >= 3 && (w.startsWith(q) || q.startsWith(w))) return w.length >= 3;
  if (q.length < FUZZY_MIN_WORD || w.length < FUZZY_MIN_WORD) return false;
  return withinOneEdit(q, w) || (w.length > q.length && withinOneEdit(q, w.slice(0, q.length)));
}

/** id товаров, в тексте которых нашлось каждое слово запроса (с опечаткой не больше одной). */
export function fuzzyIds(query: string, items: FuzzyItem[]): string[] {
  const qw = words(query);
  if (qw.length === 0) return [];
  const hits: { id: string; score: number }[] = [];
  for (const it of items) {
    const iw = words(it.text);
    let score = 0;
    let ok = true;
    for (const q of qw) {
      if (iw.includes(q)) continue;
      if (iw.some((w) => wordMatches(q, w))) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ id: it.id, score });
  }
  return hits.sort((x, y) => x.score - y.score || (x.id < y.id ? -1 : 1)).map((h) => h.id);
}
