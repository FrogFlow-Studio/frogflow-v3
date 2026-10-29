/** База знаний консультанта: документы продавца и их отбор под вопрос. Чисто. */

export type KnowledgeDoc = {
  id: string;
  title: string;
  category?: string;
  content: string;
  tags?: string[];
};

const STOP = new Set([
  "для",
  "как",
  "что",
  "или",
  "при",
  "под",
  "над",
  "это",
  "все",
  "всё",
  "про",
  "без",
  "ваш",
  "вас",
  "вам",
  "мне",
  "нам",
  "есть",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "have",
  "you",
  "your",
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Основа слова для сравнения: без окончания, но не короче четырёх букв и не
 * длиннее шести. Иначе «скатерть» не находила статью с меткой «скатерти», а
 * «одеяло» — с «одеяла»: подстрока целого слова падежа не переживает.
 */
export function stemOf(token: string): string {
  if (token.length <= 4) return token;
  return token.slice(0, Math.min(6, Math.max(4, token.length - 2)));
}

function score(doc: KnowledgeDoc, tokens: string[]): number {
  const title = doc.title.toLowerCase();
  const tags = (doc.tags ?? []).map((t) => t.toLowerCase());
  const body = `${doc.category ?? ""} ${doc.content}`.toLowerCase();
  let s = 0;
  for (const t of tokens.map(stemOf)) {
    if (title.includes(t)) s += 5;
    if (tags.some((x) => x.includes(t))) s += 3;
    if (body.includes(t)) s += 1;
  }
  return s;
}

/** Самые подходящие документы; без совпадений — первые topK (общие условия). */
export function retrieveKnowledge(query: string, docs: KnowledgeDoc[], topK = 4): KnowledgeDoc[] {
  if (docs.length === 0) return [];
  const tokens = tokenize(query);
  if (tokens.length === 0) return docs.slice(0, topK);
  const scored = docs
    .map((doc) => ({ doc, s: score(doc, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.length ? scored.slice(0, topK).map((x) => x.doc) : docs.slice(0, topK);
}

export function formatKnowledge(docs: KnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const lines = ["БАЗА ЗНАНИЙ КОМПАНИИ (единственный источник фактов):"];
  for (const d of docs) {
    lines.push(`\n[ДОКУМЕНТ: ${d.title}${d.category ? ` | ${d.category}` : ""}]`);
    lines.push(d.content.trim());
  }
  return lines.join("\n");
}

/** Разбор JSON из настроек: мусор и чужие поля не роняют консультанта. */
export function parseKnowledge(raw: string | null | undefined): KnowledgeDoc[] {
  if (!raw?.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object")
      .map((d, i) => ({
        id: typeof d.id === "string" && d.id ? d.id : `doc${i + 1}`,
        title: String(d.title ?? "").trim() || `Документ ${i + 1}`,
        category: typeof d.category === "string" ? d.category : undefined,
        content: String(d.content ?? "").trim(),
        tags: Array.isArray(d.tags) ? d.tags.map(String) : undefined,
      }))
      .filter((d) => d.content);
  } catch {
    return [];
  }
}
