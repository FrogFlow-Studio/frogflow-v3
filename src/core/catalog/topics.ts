/**
 * «Тема» материала (Т5, пожелания Кристины): главное слово, по которому
 * подбираются «Похожие» на витрине, — «1 сентября», «Части речи». Колонки для
 * темы в схеме нет (она не меняется), поэтому тема живёт служебной частью в
 * конце `products.keywords`: «пропись, 1 класс #тема: 1 сентября, Части речи».
 * Поиск витрины и бота находит товар и по теме (это то же поле), v1 видит её
 * как лишние ключевые слова. Форма товара показывает слова и темы раздельно.
 */

/** Метка начала тем в ключевых словах; всё после неё — темы через запятую. */
export const TOPIC_MARK = "#тема:";
/** Не больше тем у одного товара и символов в теме. */
export const TOPICS_MAX = 10;
export const TOPIC_LEN_MAX = 60;

const MARK_RE = /#тема:/i;

/** Ключ сравнения тем: без регистра, ё = е, пробелы схлопнуты («1-е  Сентября» ≠ «1 сентября»). */
export function topicKey(topic: string): string {
  return topic.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** Темы из строки продавца («1 сентября, Части речи»): без пустых и повторов, в его написании. */
export function cleanTopics(raw: readonly string[] | string): string[] {
  const parts =
    typeof raw === "string" ? raw.split(/[,;\n]/) : raw.flatMap((t) => t.split(/[,;\n]/));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.replace(/#/g, "").trim().replace(/\s+/g, " ").slice(0, TOPIC_LEN_MAX).trim();
    const k = topicKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= TOPICS_MAX) break;
  }
  return out;
}

/** Ключевые слова товара: обычные слова отдельно, темы отдельно. */
export function splitKeywords(keywords: string | null | undefined): {
  words: string;
  topics: string[];
} {
  const s = keywords ?? "";
  const m = MARK_RE.exec(s);
  if (!m) return { words: s.trim(), topics: [] };
  return {
    words: s.slice(0, m.index).trim(),
    topics: cleanTopics(s.slice(m.index + m[0].length)),
  };
}

/** Обратно в одну строку `keywords`; метку, вписанную в слова руками, убираем. */
export function joinKeywords(words: string, topics: readonly string[]): string {
  const plain = splitKeywords(words).words;
  const list = cleanTopics(topics);
  if (list.length === 0) return plain;
  return `${plain ? `${plain} ` : ""}${TOPIC_MARK} ${list.join(", ")}`;
}

/** Темы товара по его ключевым словам. */
export function productTopics(keywords: string | null | undefined): string[] {
  return splitKeywords(keywords).topics;
}

/**
 * Значимые слова для «похожих» второй очереди: без тем, чисел и кодов
 * (всё, где есть цифра), короче трёх букв не берём.
 */
export function keywordWords(keywords: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of splitKeywords(keywords).words.split(/[\s,;|/#.:!?()"«»]+/)) {
    const k = w.toLowerCase().replace(/ё/g, "е");
    if (k.length < 3 || /\d/.test(k)) continue;
    out.add(k);
  }
  return out;
}

/** Добавить тему товару или убрать её (массовое назначение); null — менять нечего. */
export function withTopic(
  keywords: string | null | undefined,
  topic: string,
  mode: "add" | "remove",
): string | null {
  const { words, topics } = splitKeywords(keywords);
  const want = cleanTopics([topic])[0];
  if (!want) return null;
  const k = topicKey(want);
  const has = topics.some((t) => topicKey(t) === k);
  if (mode === "add") {
    if (has || topics.length >= TOPICS_MAX) return null;
    return joinKeywords(words, [...topics, want]);
  }
  if (!has) return null;
  return joinKeywords(
    words,
    topics.filter((t) => topicKey(t) !== k),
  );
}

/** Все темы магазина для подсказок: по частоте, затем по алфавиту; написание — самое частое. */
export function topicSuggestions(keywordsList: ReadonlyArray<string | null | undefined>): string[] {
  const byKey = new Map<string, { n: number; spell: Map<string, number> }>();
  for (const kw of keywordsList)
    for (const t of productTopics(kw)) {
      const k = topicKey(t);
      const e = byKey.get(k) ?? { n: 0, spell: new Map() };
      e.n += 1;
      e.spell.set(t, (e.spell.get(t) ?? 0) + 1);
      byKey.set(k, e);
    }
  return [...byKey.values()]
    .map((e) => ({
      n: e.n,
      name: [...e.spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
    }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ru"))
    .map((e) => e.name);
}
