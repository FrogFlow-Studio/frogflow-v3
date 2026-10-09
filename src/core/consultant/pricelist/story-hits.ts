import { storyProductsOf, type StoryTag } from "../story-tags";
import { findProducts, type ConsultantProduct } from "./catalog";

/**
 * Хиты — что продавец сейчас продвигает: главные товары последних отмеченных
 * сторис, которые есть в наличии.
 *
 * BOVI 25.09–09.10: на «Цена?» и 😍 к сторис без отметки консультант
 * спрашивал «что из публикации?», и половина покупателей замолкала. Продаж
 * BOVI в системе нет (заказы ведёт менеджер), поэтому «хит» берём из отметок
 * сторис: их продавец ставит на то, что публикует. С каждой сторис — один
 * товар (на сторис комплекта бывает 45 расцветок), новые сторис первыми.
 */
export function storyHits(
  tags: StoryTag[],
  catalog: ConsultantProduct[],
  limit = 3,
): ConsultantProduct[] {
  const hits: ConsultantProduct[] = [];
  const newest = [...tags].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  for (const tag of newest) {
    if (hits.length >= limit) break;
    const main = storyProductsOf(tag)[0];
    if (!main) continue;
    const byId = main.id ? catalog.find((p) => p.id === main.id) : undefined;
    const found = byId ?? findProducts({ query: main.name }, catalog).shown[0];
    if (!found || !found.stock || hits.some((p) => p.id === found.id)) continue;
    hits.push(found);
  }
  return hits;
}
