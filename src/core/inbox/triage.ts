/**
 * Разбор свободной реплики в Direct/WhatsApp перед обращением продавцу
 * (Яков 12.10, разбор 133 обращений Копилки). Что это — решает модель, не
 * список слов в коде (решение Якова 10.10):
 * - chatter — «спасибо», «Благодарю! 🌹», «Браво!», «🔥», «+», «Я подписан(а)»:
 *   ни вопроса, ни просьбы. Обращение не открываем (22 из 133 у Копилки).
 * - foreign_pay — как оплатить из своей страны или цена в её валюте («В бел.
 *   руб можно»): если у магазина нет способа оплаты для этой страны, бот один
 *   раз честно отвечает, что оплату оттуда подключают, а вопрос — продавцу.
 *   Копилка 12.10: кулик виктория спросила, бот промолчал, она ушла.
 * - other — всё остальное: прежний путь, обращение продавцу.
 *
 * Здесь — чистые правила: промпт, инструмент, разбор ответа. Вызов модели —
 * triage.server.ts, исполнение — адаптер канала.
 */

export type TriageKind = "chatter" | "foreign_pay" | "other";
/** country — ISO-код страны покупателя (или страны валюты), если понятно. */
export type Triage = { kind: TriageKind; country: string | null };

export const TRIAGE_MODEL = "claude-sonnet-5";
/** Sonnet 5, $ за миллион токенов. */
export const TRIAGE_PRICE = { in: 2, out: 10 };
/** Не открывать обращение на «спасибо», эмодзи, «+». «false» — выключено; по умолчанию включено. */
export const CHAT_SKIP_CHATTER_KEY = "chat_skip_chatter";
/** Отвечать про оплату из страны без способа оплаты. «false» — выключено; по умолчанию включено. */
export const CHAT_FOREIGN_PAY_KEY = "chat_foreign_pay";
/** Потолок расхода в день, $; нет ключа — TRIAGE_DAILY_USD. */
export const TRIAGE_CAP_KEY = "inbox_triage_daily_usd";
export const triageSpendKey = (date: string) => `inbox_triage_spend:${date}`;
/** ≈0,001 $ за сообщение: около 300 сообщений в день. */
export const TRIAGE_DAILY_USD = 0.3;
export const TRIAGE_TIMEOUT_MS = 8_000;
/** Длиннее — это уже разговор: прежним путём, к продавцу. */
export const TRIAGE_MAX_TEXT = 300;

export function skipChatterOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}
export function foreignPayOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}

export const TRIAGE_SYSTEM = `Ты помогаешь боту магазина в Instagram/WhatsApp решить, что делать с сообщением покупателя, на которое у бота нет готового ответа. Обычно такое сообщение уходит продавцу обращением. Сам ты покупателю не пишешь: ответь инструментом triage.

kind:
- chatter — в сообщении нет ни вопроса, ни просьбы, продавцу отвечать не на что: благодарность или прощание («спасибо», «Благодарю! 🌹», «получила, спасибо»), похвала («Браво!», «Класс»), только эмодзи или стикер-смайл («🔥», «❤️👍»), «+», «1», «ок», «Я подписан(а)», «подписалась». Если в сообщении есть хоть какой-то вопрос или просьба («спасибо, а когда придёт?», «+ хочу палитру») — не chatter.
- foreign_pay — покупатель спрашивает, можно ли оплатить из своей страны или в своей валюте, как оплатить оттуда, или цену в своей валюте: «В бел. руб можно», «Я из Узбекистана, как оплатить?», «сколько в сумах?», «можно посчитать в сомах», «оплачу картой Беларуси?». country — ISO-код этой страны (по названию, городу, валюте или банку: белорусские рубли — BY, сумы — UZ, сомы — KG, рубли или карта РФ — RU, тенге или Kaspi — KZ); не понять — пустая строка.
- other — всё остальное: вопрос о товаре, цене без страны и валюты, доставке, оплате вообще, жалоба, приветствие, разговор с продавцом, непонятно. Сомневаешься — other: тогда сообщение увидит продавец.`;

export const TRIAGE_TOOL = {
  name: "triage",
  description: "Что делать с последним сообщением покупателя.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["chatter", "foreign_pay", "other"] },
      country: { type: "string" },
    },
    required: ["kind", "country"],
  },
};

export type TriageLine = { sender: string; text: string };

const SENDER: Record<string, string> = { customer: "Покупатель", bot: "Бот", manager: "Продавец" };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function triageUserPrompt(p: { text: string; lines: readonly TriageLine[] }): string {
  const history = p.lines
    .map((l) => `${SENDER[l.sender] ?? l.sender}: ${clip(l.text.replace(/\s+/g, " "), 200)}`)
    .join("\n");
  return [
    history ? `Переписка до этого:\n${history}` : "",
    `Последнее сообщение покупателя: «${clip(p.text.trim(), TRIAGE_MAX_TEXT)}»`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const TRIAGE_OTHER: Triage = { kind: "other", country: null };

/** Ответ модели: неизвестный вид — other; код страны — две латинские буквы. */
export function parseTriage(input: unknown): Triage {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind: TriageKind = v.kind === "chatter" || v.kind === "foreign_pay" ? v.kind : "other";
  const raw = typeof v.country === "string" ? v.country.trim().toUpperCase() : "";
  const country = /^[A-Z]{2}$/.test(raw) ? raw : null;
  return { kind, country: kind === "foreign_pay" ? country : null };
}

export function triageCostUsd(
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
) {
  const i = Number(usage?.input_tokens) || 0;
  const o = Number(usage?.output_tokens) || 0;
  return Math.round(((i * TRIAGE_PRICE.in + o * TRIAGE_PRICE.out) / 1e6) * 1e6) / 1e6;
}

export function parseTriageCap(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : TRIAGE_DAILY_USD;
}

/**
 * Отвечать ли «оплату из вашей страны подключаем»: страна понятна, это не
 * Россия (у неё свой путь — карта РФ через Продамус или реквизиты) и у
 * магазина нет способа оплаты для неё. Есть способ — прежний путь.
 */
export function foreignPayApplies(t: Triage, payCountries: readonly string[]): boolean {
  if (t.kind !== "foreign_pay" || !t.country) return false;
  if (t.country === "RU") return false;
  return !payCountries.includes(t.country);
}

/** Название страны для продавца (обращение, уведомление). */
const COUNTRY_RU: Record<string, string> = {
  BY: "Беларусь",
  UZ: "Узбекистан",
  KG: "Кыргызстан",
  TJ: "Таджикистан",
  TM: "Туркменистан",
  AZ: "Азербайджан",
  AM: "Армения",
  GE: "Грузия",
  MD: "Молдова",
  UA: "Украина",
  KZ: "Казахстан",
  RU: "Россия",
};
export function countryNameRu(code: string): string {
  return COUNTRY_RU[code] ?? code;
}
