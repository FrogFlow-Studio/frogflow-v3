/**
 * Загрузка статей базы знаний из файла (PDF, Word) или вставленного текста:
 * разбор в статьи для предпросмотра и слияние с тем, что уже есть.
 * Без базы и без node — его читают и сервер, и форма в браузере (пределы).
 */
import { parseKnowledgeArticlesFromText, type ConsultantKnowledgeArticle } from "./knowledge";

/**
 * Предел на файл. Тело запроса serverless-функции ограничено ~4.5 МБ, а
 * base64 раздувает файл примерно на треть — 3 МБ проходят с запасом.
 */
export const KNOWLEDGE_FILE_MAX_MB = 3;

/**
 * Предел на статью. Каталог на сотню страниц одной статьёй консультант
 * забирал бы в промпт целиком (search_knowledge), платно и медленно.
 */
export const KNOWLEDGE_ARTICLE_MAX_CHARS = 20_000;

/** Сколько статей всего держит база — столько же принимает сохранение в админке. */
export const KNOWLEDGE_MAX_ARTICLES = 200;

/** Предел вставленного текста (символов) — порядка сотни страниц. */
export const KNOWLEDGE_TEXT_MAX_CHARS = 400_000;

const TITLE_MAX = 200;
const TAGS_MAX = 20;

export type ImportedArticle = { title: string; tags: string[]; content: string };

/** Есть ли в тексте разделители статей — от этого зависит, чем назвать статью. */
export function hasSectionMarkers(text: string): boolean {
  return /(?:^|\n)\s*(?:---+|###+|##+)/.test(text);
}

/** Имя файла без расширения — заголовок статьи, когда разделителей в файле нет. */
export function titleFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base || "Документ";
}

/**
 * Статьи из текста. Разделители и теги — как у parseKnowledgeArticlesFromText
 * (### или --- между статьями, «Теги: …» или [теги] в заголовке). В файле без
 * разделителей (PDF фабрики) получается одна статья, и заголовком берём имя
 * файла: иначе им станет случайная первая строка вёрстки (как в v1).
 * Длинная статья обрезается до KNOWLEDGE_ARTICLE_MAX_CHARS — число обрезанных
 * возвращается, чтобы продавец видел это в предпросмотре.
 */
export function articlesFromText(
  raw: string,
  fileName?: string,
): { articles: ImportedArticle[]; truncated: number } {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return { articles: [], truncated: 0 };
  let parsed: ImportedArticle[] = parseKnowledgeArticlesFromText(text).map((a) => ({
    title: a.title,
    tags: a.tags,
    content: a.content,
  }));
  if (fileName && parsed.length === 1 && !hasSectionMarkers(text))
    parsed = [{ title: titleFromFileName(fileName), tags: parsed[0]!.tags, content: text }];
  let truncated = 0;
  const articles = parsed
    .map((a) => {
      const content = a.content.trim();
      if (content.length > KNOWLEDGE_ARTICLE_MAX_CHARS) truncated++;
      return {
        title: a.title.trim().slice(0, TITLE_MAX),
        tags: a.tags.slice(0, TAGS_MAX),
        content: content.slice(0, KNOWLEDGE_ARTICLE_MAX_CHARS),
      };
    })
    .filter((a) => a.title && a.content);
  return { articles, truncated };
}

/** Заголовок для сравнения: без регистра и лишних пробелов. */
export function titleKey(title: string): string {
  return title.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/**
 * Какие из новых статей заменят существующие (тот же заголовок): предпросмотр
 * показывает это продавцу до сохранения.
 */
export function previewMerge(
  existing: Pick<ConsultantKnowledgeArticle, "title">[],
  incoming: ImportedArticle[],
): Array<ImportedArticle & { replaces: boolean }> {
  const titles = new Set(existing.map((a) => titleKey(a.title)));
  return incoming.map((a) => ({ ...a, replaces: titles.has(titleKey(a.title)) }));
}

/**
 * Слить новые статьи с базой. Существующие статьи остаются все и на своих
 * местах; статья с тем же заголовком обновляется (текст новый, теги — оба
 * набора, id прежний), остальные добавляются в конец. Повтор заголовка внутри
 * загрузки не склеивается — обе статьи добавятся.
 */
export function mergeKnowledge(
  existing: ConsultantKnowledgeArticle[],
  incoming: ImportedArticle[],
  now = new Date(),
): { articles: ConsultantKnowledgeArticle[]; added: number; updated: number } {
  const at = now.toISOString();
  const merged = existing.map((a) => ({ ...a }));
  const byTitle = new Map<string, number>();
  merged.forEach((a, i) => {
    const k = titleKey(a.title);
    if (!byTitle.has(k)) byTitle.set(k, i);
  });
  const ids = new Set(merged.map((a) => a.id));
  const stamp = now.getTime().toString(36);
  let seq = 0;
  const freshId = () => {
    let id: string;
    do id = `kb-${stamp}-${seq++}`;
    while (ids.has(id));
    ids.add(id);
    return id;
  };
  const touched = new Set<number>();
  let added = 0;
  let updated = 0;
  for (const a of incoming) {
    const i = byTitle.get(titleKey(a.title));
    if (i !== undefined && !touched.has(i)) {
      const cur = merged[i]!;
      merged[i] = {
        ...cur,
        tags: [...new Set([...cur.tags, ...a.tags])].slice(0, TAGS_MAX),
        content: a.content,
        updatedAt: at,
      };
      touched.add(i);
      updated++;
      continue;
    }
    merged.push({ id: freshId(), title: a.title, tags: a.tags, content: a.content, updatedAt: at });
    added++;
  }
  return { articles: merged, added, updated };
}
