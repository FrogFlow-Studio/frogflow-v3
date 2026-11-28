/**
 * Карточка магазина в чате. Один экран — одно сообщение: фото, цена, кнопки.
 * Telegram правит это сообщение. Instagram и WhatsApp правку не умеют:
 * там уходит новое, и кнопок не больше трёх. Голос и реакция заказ не создают.
 */

export const CARD_LANGS = ["ru", "kk", "en", "uz"] as const;
export type CardLang = (typeof CARD_LANGS)[number];

export const CARD_CHANNELS = ["telegram", "instagram", "whatsapp"] as const;
export type CardChannel = (typeof CARD_CHANNELS)[number];

export type CardButton = {
  label: string;
  data: string;
  webAppUrl?: string;
};

export type ShopCard = {
  screen: "catalog" | "product" | "cart" | "order" | "checkout" | "lesson";
  text: string;
  photoUrl?: string;
  buttons: CardButton[];
};

export type Delivery =
  { op: "send"; card: ShopCard } | { op: "edit"; messageId: string; card: ShopCard };

type L = Record<CardLang, string>;

const BUY: L = { ru: "Купить", kk: "Сатып алу", en: "Buy", uz: "Sotib olish" };
const BACK: L = { ru: "Назад", kk: "Артқа", en: "Back", uz: "Orqaga" };
const OPEN: L = { ru: "Открыть", kk: "Ашу", en: "Open", uz: "Ochish" };
const NEXT: L = { ru: "Дальше", kk: "Келесі", en: "Next", uz: "Keyingi" };
const PREV: L = { ru: "Назад", kk: "Артқа", en: "Back", uz: "Orqaga" };
const HUMAN: L = { ru: "Человек", kk: "Адам", en: "Person", uz: "Odam" };
const VOICE: L = {
  ru: "Голос заказ не оформляет. Нажмите кнопку на карточке.",
  kk: "Дауыс тапсырыс жасамайды. Карточкадағы батырманы басыңыз.",
  en: "A voice note does not place an order. Press a button on the card.",
  uz: "Ovozli xabar buyurtma qilmaydi. Kartadagi tugmani bosing.",
};

const PAID: L = { ru: "Оплачено", kk: "Төленді", en: "Paid", uz: "To'landi" };
const DEPOSIT: L = { ru: "Задаток", kk: "Алдын ала төлем", en: "Deposit", uz: "Oldindan to'lov" };
const UNPAID: L = { ru: "Не оплачено", kk: "Төленбеген", en: "Unpaid", uz: "To'lanmagan" };
const OVER: L = { ru: "Переплата", kk: "Артық төлем", en: "Overpaid", uz: "Ortiqcha to'lov" };

const STEP: Record<string, L> = {
  accepted: { ru: "Принят", kk: "Қабылданды", en: "Accepted", uz: "Qabul qilindi" },
  working: { ru: "В работе", kk: "Жұмыста", en: "In progress", uz: "Ishlanmoqda" },
  ready: { ru: "Готов", kk: "Дайын", en: "Ready", uz: "Tayyor" },
  handed: { ru: "Передан", kk: "Тапсырылды", en: "Handed over", uz: "Topshirildi" },
};

const LESSON: L = {
  ru: "Урок открыт",
  kk: "Сабақ ашылды",
  en: "Lesson is open",
  uz: "Dars ochildi",
};

function langOf(lang: string): CardLang {
  return (CARD_LANGS as readonly string[]).includes(lang) ? (lang as CardLang) : "ru";
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export function moneyWord(state: "unpaid" | "partial" | "paid" | "overpaid", lang: string): string {
  const l = langOf(lang);
  if (state === "paid") return PAID[l];
  if (state === "overpaid") return OVER[l];
  if (state === "partial") return DEPOSIT[l];
  return UNPAID[l];
}

/** Кнопок в Direct не больше трёх. «Купить» и «Назад» важнее «Открыть». */
export function fitButtons(channel: CardChannel, buttons: CardButton[]): CardButton[] {
  if (channel === "telegram") return buttons;
  const rest = buttons.filter((b) => !b.webAppUrl);
  const buy = rest.find((b) => b.data.startsWith("offer:"));
  const back = rest.find((b) => b.data === "back" || b.data.startsWith("nav:"));
  const picked: CardButton[] = [];
  if (buy) picked.push(buy);
  if (back && back !== buy) picked.push(back);
  for (const b of rest) {
    if (picked.length >= 3) break;
    if (!picked.includes(b)) picked.push(b);
  }
  return picked.slice(0, 3);
}

export function deliverPlan(
  channel: CardChannel,
  card: ShopCard,
  heldMessageId: string | null,
): Delivery {
  const fitted = { ...card, buttons: fitButtons(channel, card.buttons) };
  if (channel === "telegram" && heldMessageId)
    return { op: "edit", messageId: heldMessageId, card: fitted };
  return { op: "send", card: fitted };
}

/** Правку канал отверг — тогда новое сообщение. Обрыв вторым сообщением не закрываем. */
export function afterEdit(outcome: "sent" | "failed" | "unknown"): "keep" | "send_new" {
  return outcome === "failed" ? "send_new" : "keep";
}

export function productCard(input: {
  title: string;
  totalMinor: number;
  currency: string;
  offerId: string;
  lang?: string;
  photoUrl?: string;
  productId?: string;
  shopBase?: string;
}): ShopCard {
  const l = langOf(input.lang ?? "ru");
  const open =
    input.shopBase && input.productId
      ? {
          label: OPEN[l],
          data: `offer:${input.offerId}`,
          webAppUrl: `${input.shopBase.replace(/\/$/, "")}/p/${input.productId}?offer=${input.offerId}`,
        }
      : null;
  return {
    screen: "product",
    text: `${input.title}\n${money(input.totalMinor, input.currency)}`,
    ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
    buttons: [
      ...(open ? [open] : []),
      { label: BUY[l], data: `offer:${input.offerId}` },
      { label: BACK[l], data: "back" },
    ],
  };
}

export type CatalogItem = { id: string; title: string };

export function catalogCard(input: {
  items: CatalogItem[];
  page: number;
  lang?: string;
}): ShopCard {
  const l = langOf(input.lang ?? "ru");
  const page = Math.max(0, input.page);
  const item = input.items[page];
  const buttons: CardButton[] = [];
  if (page > 0) buttons.push({ label: PREV[l], data: `nav:${page - 1}` });
  if (item) buttons.push({ label: item.title, data: `open:${item.id}` });
  if (page + 1 < input.items.length) buttons.push({ label: NEXT[l], data: `nav:${page + 1}` });
  const title = item ? item.title : "—";
  return {
    screen: "catalog",
    text: `${page + 1}/${Math.max(input.items.length, 1)}\n${title}`,
    buttons,
  };
}

export function orderCard(input: {
  no: number;
  state: "unpaid" | "partial" | "paid" | "overpaid";
  paidMinor: number;
  dueMinor: number;
  currency: string;
  others?: { currency: string; amountMinor: number }[];
  step?: string | null;
  lang?: string;
}): ShopCard {
  const l = langOf(input.lang ?? "ru");
  const lines = [
    `№${input.no}`,
    `${moneyWord(input.state, l)}: ${money(input.paidMinor, input.currency)}`,
    `${money(input.dueMinor, input.currency)}`,
  ];
  for (const o of input.others ?? []) {
    if (o.currency !== input.currency) lines.push(money(o.amountMinor, o.currency));
  }
  const step = input.step ? STEP[input.step] : undefined;
  if (step) lines.push(step[l]);
  return { screen: "order", text: lines.join("\n"), buttons: [{ label: HUMAN[l], data: "human" }] };
}

export function lessonCard(input: { title: string; lessonId: string; lang?: string }): ShopCard {
  const l = langOf(input.lang ?? "ru");
  return {
    screen: "lesson",
    text: `${LESSON[l]}\n${input.title}`,
    buttons: [{ label: OPEN[l], data: `lesson:${input.lessonId}` }],
  };
}

/** Голосовое без модели просит кнопку. Заказа в ответе нет. */
export function voiceCard(lang?: string): ShopCard {
  return { screen: "catalog", text: VOICE[langOf(lang ?? "ru")], buttons: [] };
}

/** Реакция на сообщение покупкой не считается. */
export function reactionOrder(): null {
  return null;
}
