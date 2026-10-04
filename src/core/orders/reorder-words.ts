/**
 * Слова «повторить прошлый заказ» на четырёх языках: Telegram, Instagram
 * Direct и WhatsApp понимают их целым сообщением (Б11). Сравнение после
 * `normalizeReorderWord`: без регистра, знаков на концах и лишних пробелов.
 */
export const REORDER_WORDS: readonly string[] = [
  "повторить",
  "повторить заказ",
  "повторить прошлый заказ",
  "как в прошлый раз",
  "такой же заказ",
  "қайталау",
  "тапсырысты қайталау",
  "өткен жолғыдай",
  "reorder",
  "repeat order",
  "repeat my order",
  "same as last time",
  "takrorlash",
  "buyurtmani takrorlash",
  "oldingidek",
];

export function normalizeReorderWord(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/^[«"]+|[»"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReorderWord(text: string | null | undefined): boolean {
  const n = normalizeReorderWord(text ?? "");
  return n !== "" && REORDER_WORDS.includes(n);
}
