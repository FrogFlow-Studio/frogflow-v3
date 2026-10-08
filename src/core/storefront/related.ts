import { keywordWords, productTopics, topicKey } from "@/core/catalog/topics";

/** Сколько «Похожих» показывает карточка товара. */
export const RELATED_MAX = 4;

/** Товар витрины для подбора похожих; список кандидатов — в порядке каталога продавца. */
export type RelatedCandidate = {
  id: string;
  keywords: string | null;
  categoryIds: readonly string[];
  /** Языки материалов (пусто без модуля multi_language). */
  languages: readonly string[];
  createdAt: string;
};

/**
 * «Похожие» по очереди (Т5): сначала товары с той же темой (больше общих тем —
 * выше, при равенстве — с тем же языком материала, затем новые); если меньше
 * `limit` — с общими ключевыми словами (без чисел и кодов); затем из той же
 * категории в порядке продавца, как было до тем; товар без категории
 * добирает из всего каталога (поведение v1). Без тем и слов выходит прежний
 * подбор по категории. `sameCategory` — категория товара с подкатегориями.
 */
export function rankRelated(
  current: RelatedCandidate,
  candidates: readonly RelatedCandidate[],
  sameCategory: ReadonlySet<string> | null,
  limit = RELATED_MAX,
): string[] {
  const pool = candidates.filter((c) => c.id !== current.id);
  const out: string[] = [];
  const taken = new Set<string>();
  const take = (ids: Iterable<string>) => {
    for (const id of ids) {
      if (out.length >= limit) return;
      if (taken.has(id)) continue;
      taken.add(id);
      out.push(id);
    }
  };
  const order = new Map(pool.map((c, i) => [c.id, i]));
  const byCatalog = (a: RelatedCandidate, b: RelatedCandidate) =>
    order.get(a.id)! - order.get(b.id)!;

  const topics = new Set(productTopics(current.keywords).map(topicKey));
  if (topics.size > 0) {
    const langs = new Set(current.languages);
    const scored = pool
      .map((c) => ({
        c,
        shared: productTopics(c.keywords).filter((t) => topics.has(topicKey(t))).length,
        sameLang: c.languages.some((l) => langs.has(l)) ? 1 : 0,
      }))
      .filter((x) => x.shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared ||
          b.sameLang - a.sameLang ||
          b.c.createdAt.localeCompare(a.c.createdAt) ||
          a.c.id.localeCompare(b.c.id),
      );
    take(scored.map((x) => x.c.id));
  }

  const words = keywordWords(current.keywords);
  if (out.length < limit && words.size > 0) {
    const scored = pool
      .filter((c) => !taken.has(c.id))
      .map((c) => {
        let shared = 0;
        for (const w of keywordWords(c.keywords)) if (words.has(w)) shared += 1;
        return { c, shared };
      })
      .filter((x) => x.shared > 0)
      .sort((a, b) => b.shared - a.shared || byCatalog(a.c, b.c));
    take(scored.map((x) => x.c.id));
  }

  if (out.length < limit && sameCategory && sameCategory.size > 0)
    take(pool.filter((c) => c.categoryIds.some((id) => sameCategory.has(id))).map((c) => c.id));

  if (out.length < limit && current.categoryIds.length === 0) take(pool.map((c) => c.id));
  return out;
}
