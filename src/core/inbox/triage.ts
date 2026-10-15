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
 * - payment_failed — на шаге оплаты: «Не проходит», «ошибка», «отклонено» —
 *   платёж не прошёл. Чек с такой подписью не регистрируется (AATeach 12.10,
 *   kopats23 #1435: фото и «Не проходит» → «✅ Чек получен»).
 * - cant_send_receipt — не получается прислать скриншот сюда («скриншот не
 *   загружается», «можно чек на ватсап?»): бот предлагает чек текстом
 *   (AATeach 12.10, asya_6465 и galinka.iva).
 * - text_receipt — на шаге оплаты: вставленный текст уведомления или чека
 *   банка об оплате («Покупка: 1 700 ₸ / ИП КОПИЛКА РУСОВЕДА / Доступно: …»):
 *   принимается как чек текстом (Копилка 12.10, taurgalievna #148 — тишина,
 *   в пуше Kaspi нет слов «оплата совершена» и номера чека).
 * - how_to_pay — на шаге оплаты: «как перейти на оплату?», «куда платить?»,
 *   название своего банка в ответ на «какой у вас банк»: бот ещё раз
 *   присылает шаг оплаты (Копилка 12.10, janat021265 #147 — тишина).
 * - how_to_buy — заказа ещё нет, а покупатель спрашивает, как получить,
 *   купить или заказать материал: если недавно ушла карточка с «Купить»,
 *   бот зовёт её нажать (Копилка 12.10, boranbaeva__ainur после карточки
 *   «Матрёшек» — «Как можно получить», тишина).
 * - several_items — несколько материалов одним заказом или одним чеком
 *   («Можно вот эти 2 материала одним чеком»): корзины из двух товаров в
 *   быстрой покупке нет, бот один раз отвечает, что вопрос у продавца
 *   (Копилка 13.10, gvar41391 #190 — тишина).
 * - product_request — покупатель называет материал, которого бот не нашёл
 *   по названию («Классный уголок» четыре раза, «Материал для доски»): один
 *   ответ «вопрос у продавца» и каталог (Копилка 13.10 — обращение и тишина).
 * - other — всё остальное: прежний путь, обращение продавцу.
 *
 * Здесь — чистые правила: промпт, инструмент, разбор ответа. Вызов модели —
 * triage.server.ts, исполнение — адаптер канала.
 */

export type TriageKind =
  | "chatter"
  | "foreign_pay"
  | "payment_failed"
  | "cant_send_receipt"
  | "text_receipt"
  | "how_to_pay"
  | "how_to_buy"
  | "several_items"
  | "product_request"
  | "other";
/**
 * country — ISO-код страны покупателя (или страны валюты), если понятно:
 * у foreign_pay и payment_failed (оплата из Кыргызстана не прошла через Kaspi).
 */
export type Triage = { kind: TriageKind; country: string | null };

export const TRIAGE_MODEL = "claude-sonnet-5";
/** Sonnet 5, $ за миллион токенов. */
export const TRIAGE_PRICE = { in: 2, out: 10 };
/** Не открывать обращение на «спасибо», эмодзи, «+». «false» — выключено; по умолчанию включено. */
export const CHAT_SKIP_CHATTER_KEY = "chat_skip_chatter";
/** Отвечать про оплату из страны без способа оплаты. «false» — выключено; по умолчанию включено. */
export const CHAT_FOREIGN_PAY_KEY = "chat_foreign_pay";
/** Не принимать чек, если покупатель пишет, что платёж не прошёл. «false» — выключено. */
export const CHAT_PAY_FAILED_KEY = "chat_pay_failed";
/** Скриншот не отправляется — предложить чек текстом. «false» — выключено. */
export const CHAT_RECEIPT_TEXT_OFFER_KEY = "chat_receipt_text_offer";
/** «Как получить?» после карточки с «Купить» — позвать нажать кнопку. «false» — выключено. */
export const CHAT_HOW_TO_BUY_KEY = "chat_how_to_buy";
/** «Несколько материалов одним чеком?» — ответ «вопрос у продавца». «false» — выключено. */
export const CHAT_SEVERAL_ITEMS_KEY = "chat_several_items";
/** Название материала без правила и товара — ответ «вопрос у продавца» и каталог. «false» — выключено. */
export const CHAT_PRODUCT_REQUEST_KEY = "chat_product_request";
/**
 * «Не отвечать на обычные сообщения»: ответы разбора вне шага оплаты (оплата
 * из страны, «как получить?», несколько материалов, название материала)
 * молчат, вопрос уходит продавцу. Любой ответ бота помечает диалог в
 * Instagram прочитанным, и продавец его не видит (AATeach 15.10,
 * lenchik_ashotovna). «true» — включено; по умолчанию выключено.
 */
export const CHAT_KEEP_UNREAD_KEY = "chat_keep_unread";
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
export function payFailedOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}
export function receiptTextOfferOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}
export function howToBuyOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}
export function keepUnreadOn(raw: string | null | undefined): boolean {
  return raw?.trim() === "true";
}
export function severalItemsOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}
export function productRequestOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}

export const TRIAGE_SYSTEM = `Ты помогаешь боту магазина в Instagram/WhatsApp решить, что делать с сообщением покупателя, на которое у бота нет готового ответа. Обычно такое сообщение уходит продавцу обращением. Сам ты покупателю не пишешь: ответь инструментом triage.

kind:
- chatter — в сообщении нет ни вопроса, ни просьбы, продавцу отвечать не на что: благодарность или прощание («спасибо», «Благодарю! 🌹», «получила, спасибо»), похвала («Браво!», «Класс»), только эмодзи или стикер-смайл («🔥», «❤️👍»), «+», «1», «ок», «Я подписан(а)», «подписалась». Если в сообщении есть хоть какой-то вопрос или просьба («спасибо, а когда придёт?», «+ хочу палитру») — не chatter.
- foreign_pay — покупатель спрашивает, можно ли оплатить из своей страны или в своей валюте, как оплатить оттуда, или цену в своей валюте: «В бел. руб можно», «Я из Узбекистана, как оплатить?», «сколько в сумах?», «можно посчитать в сомах», «оплачу картой Беларуси?». country — ISO-код этой страны (по названию, городу, валюте или банку: белорусские рубли — BY, сумы — UZ, сомы — KG, рубли или карта РФ — RU, тенге или Kaspi — KZ); не понять — пустая строка.
- payment_failed — покупатель сообщает, что оплата не прошла или не получится: перевод не проходит, банк отклонил, ошибка платежа, деньги не ушли, этим способом оплатить не может («Не проходит», «ошибка», «отклонено», «карта не принимает», «не получилось оплатить», «Не получится»). Если вместе с сообщением прислано фото — это, скорее всего, скриншот ошибки, а не чек. Если покупатель пишет, что оплатил, но не может прислать чек, — это не payment_failed. country — страна покупателя, если из сообщения или переписки понятно, откуда он («Я с Кыргызстана» раньше в переписке — KG); не понять — пустая строка.
- cant_send_receipt — покупатель оплатил или готов оплатить, но не может прислать сюда скриншот или чек: «скриншот не загружается», «не получается отправить чек сюда», «можно чек на ватсап?», «куда скинуть чек, тут не отправляется».
- text_receipt — покупатель вставил текстом уведомление или чек банка о совершённой оплате: сумма и магазин или получатель, часто остаток на счёте, номер операции, «Покупка: 1 700 ₸ / ИП КОПИЛКА РУСОВЕДА / Доступно: 3 668 ₸», «Перевод 1500 ₸ Кристина У. успешно». Рассказ своими словами («я оплатила 1700», «перевела») — не text_receipt.
- how_to_pay — заказ уже оформлен, а покупатель не понимает, как его оплатить, или отвечает на вопрос бота о банке: «Как перейти на оплату?», «куда платить?», «как оплатить?», «где реквизиты?», название своего банка («Каспий банк РК», «Халык») после того, как бот спросил, какой у него банк. Если человек пишет, что оплата не проходит, — это payment_failed; про оплату из другой страны или в другой валюте — foreign_pay.
- how_to_buy — покупатель спрашивает, как получить, купить или заказать материал, а заказ ещё не оформлен: «Как можно получить», «как купить?», «как заказать?», «хочу, что делать?», «как его получить и оплатить?». Если заказ уже оформлен и человек спрашивает, как его оплатить, — это how_to_pay; про оплату из другой страны — foreign_pay.
- several_items — покупатель спрашивает, можно ли купить или оплатить несколько материалов вместе: одним заказом, одним чеком, одной оплатой («Можно вот эти 2 материала одним чеком», «хочу оба, можно одной оплатой?», «можно сразу три материала?»). Нужен именно вопрос про «вместе», «одним чеком», «одной оплатой». Просто желание купить материалы, даже несколько, без такого вопроса («Хотела бы купить данные материалы» после присланных картинок или постов, «хочу эти») — не several_items, а other: что за материалы, увидит продавец.
- product_request — покупатель называет материал, который хочет получить, или спрашивает, есть ли он, и больше ни о чём не спрашивает: одно название («Классный уголок», «Материал для доски», «Собрания»), «хочу анкету писателя», «а материал для доски есть?». Бот уже искал товар по такому названию и не нашёл. Приветствие с названием («Здравствуйте, Классный уголок») — тоже product_request. Вопрос о цене, составе, доставке или оплате материала — other.
- other — всё остальное: вопрос о товаре, цене без страны и валюты, доставке, оплате вообще, жалоба, приветствие, разговор с продавцом, непонятно. Сомневаешься — other: тогда сообщение увидит продавец.`;

export const TRIAGE_TOOL = {
  name: "triage",
  description: "Что делать с последним сообщением покупателя.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: [
          "chatter",
          "foreign_pay",
          "payment_failed",
          "cant_send_receipt",
          "text_receipt",
          "how_to_pay",
          "how_to_buy",
          "several_items",
          "product_request",
          "other",
        ],
      },
      country: { type: "string" },
    },
    required: ["kind", "country"],
  },
};

export type TriageLine = { sender: string; text: string };

const SENDER: Record<string, string> = { customer: "Покупатель", bot: "Бот", manager: "Продавец" };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function triageUserPrompt(p: {
  text: string;
  lines: readonly TriageLine[];
  /** Сообщение пришло вместе с фото (подпись к картинке). */
  withPhoto?: boolean;
}): string {
  const history = p.lines
    .map((l) => `${SENDER[l.sender] ?? l.sender}: ${clip(l.text.replace(/\s+/g, " "), 200)}`)
    .join("\n");
  return [
    history ? `Переписка до этого:\n${history}` : "",
    `${p.withPhoto ? "Последнее сообщение покупателя — фото с подписью" : "Последнее сообщение покупателя"}: «${clip(p.text.trim(), TRIAGE_MAX_TEXT)}»`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const KINDS = [
  "chatter",
  "foreign_pay",
  "payment_failed",
  "cant_send_receipt",
  "text_receipt",
  "how_to_pay",
  "how_to_buy",
  "several_items",
  "product_request",
] as const;

export const TRIAGE_OTHER: Triage = { kind: "other", country: null };

/** Ответ модели: неизвестный вид — other; код страны — две латинские буквы. */
export function parseTriage(input: unknown): Triage {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind: TriageKind = (KINDS as readonly unknown[]).includes(v.kind)
    ? (v.kind as TriageKind)
    : "other";
  const raw = typeof v.country === "string" ? v.country.trim().toUpperCase() : "";
  const country = /^[A-Z]{2}$/.test(raw) ? raw : null;
  return { kind, country: kind === "foreign_pay" || kind === "payment_failed" ? country : null };
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

/**
 * «Не получится» оплатить Kaspi (способ оплаты Казахстана) у покупателя из
 * страны, для которой у магазина нет своего способа: не «какой у вас банк»,
 * а честно — Kaspi берёт только карты Казахстана, оплату оттуда подключают
 * (Копилка 12.10, kramiliia #159, Кыргызстан). Россия — свой путь (карта РФ).
 */
export function kaspiForeignApplies(
  buyerCountry: string | null | undefined,
  orderCountry: string | null | undefined,
  payCountries: readonly string[],
): boolean {
  if (!buyerCountry || orderCountry !== "KZ") return false;
  if (buyerCountry === "KZ" || buyerCountry === "RU") return false;
  return !payCountries.includes(buyerCountry);
}

/**
 * Заказ покупателя, который раньше сказал, что он из страны без способа
 * оплаты (бот уже ответил «оплату из вашей страны подключаем»): Kaspi и
 * карту РФ ему не показываем — продавец напишет сам (Копилка 13.10, #188,
 * Кыргызстан). Казахстан и Россия — свои способы, прежний путь; появился
 * способ для страны — тоже прежний путь.
 */
export function foreignOrderApplies(
  buyerCountry: string | null | undefined,
  payCountries: readonly string[],
): boolean {
  if (!buyerCountry || buyerCountry === "KZ" || buyerCountry === "RU") return false;
  return !payCountries.includes(buyerCountry);
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

/** Название страны покупателю на его языке: русский — как принято в этих странах («Кыргызстан»). */
export function countryName(code: string, locale: string): string {
  if (locale === "ru") return countryNameRu(code);
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? countryNameRu(code);
  } catch {
    return countryNameRu(code);
  }
}
