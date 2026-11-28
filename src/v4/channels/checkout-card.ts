/**
 * Оформление нажатиями. Язык, страна, оплата, получение, дата и зона — кнопки
 * на той же карточке. Печатает покупатель один раз: адрес и пожелание.
 * Режимов «напишите телефон» здесь нет.
 */

import type { CardButton, CardLang, ShopCard } from "./card";
import { CARD_LANGS } from "./card";

export type CheckoutDraft = {
  lang: CardLang | null;
  country: string | null;
  payMethod: string | null;
  fulfillment: "pickup" | "delivery" | null;
  date: string | null;
  zone: string | null;
  address: string | null;
  urgency: "today" | "later" | null;
  slot: "morning" | "day" | "evening" | null;
};

export type Choice = { id: string; label: Record<CardLang, string> };

export type CheckoutShop = {
  physical: boolean;
  flowers: boolean;
  countries: Choice[];
  payMethods: Choice[];
  zones: Choice[];
  dates: string[];
  minDate: string;
};

export type CheckoutView = {
  draft: CheckoutDraft;
  card: ShopCard;
  /** Единственное место, где покупатель печатает. */
  needText: boolean;
  done: boolean;
  handoff: boolean;
};

const LANG_LABEL: Record<CardLang, string> = {
  ru: "Русский",
  kk: "Қазақша",
  en: "English",
  uz: "O‘zbekcha",
};

type Phrase = {
  lang: string;
  country: string;
  pay: string;
  get: string;
  pickup: string;
  delivery: string;
  date: string;
  zone: string;
  address: string;
  urgent: string;
  today: string;
  later: string;
  slot: string;
  morning: string;
  day: string;
  evening: string;
  human: string;
  back: string;
  done: string;
};

const TEXT: Record<CardLang, Phrase> = {
  ru: {
    lang: "Язык",
    country: "Страна",
    pay: "Оплата",
    get: "Получение",
    pickup: "Самовывоз",
    delivery: "Доставка",
    date: "Дата",
    zone: "Зона",
    address: "Напишите адрес и пожелание одним сообщением.",
    urgent: "Когда",
    today: "Сегодня",
    later: "К дате",
    slot: "Время",
    morning: "Утро",
    day: "День",
    evening: "Вечер",
    human: "Человек",
    back: "Назад",
    done: "Дальше к оплате",
  },
  kk: {
    lang: "Тіл",
    country: "Ел",
    pay: "Төлем",
    get: "Алу",
    pickup: "Алып кету",
    delivery: "Жеткізу",
    date: "Күні",
    zone: "Аймақ",
    address: "Мекенжай мен тілекті бір хабарламамен жазыңыз.",
    urgent: "Қашан",
    today: "Бүгін",
    later: "Күнге",
    slot: "Уақыт",
    morning: "Таң",
    day: "Күн",
    evening: "Кеш",
    human: "Адам",
    back: "Артқа",
    done: "Төлемге",
  },
  en: {
    lang: "Language",
    country: "Country",
    pay: "Payment",
    get: "Handover",
    pickup: "Pickup",
    delivery: "Delivery",
    date: "Date",
    zone: "Zone",
    address: "Send the address and a note in one message.",
    urgent: "When",
    today: "Today",
    later: "On a date",
    slot: "Time",
    morning: "Morning",
    day: "Day",
    evening: "Evening",
    human: "Person",
    back: "Back",
    done: "Continue to payment",
  },
  uz: {
    lang: "Til",
    country: "Mamlakat",
    pay: "To'lov",
    get: "Olish",
    pickup: "Olib ketish",
    delivery: "Yetkazish",
    date: "Sana",
    zone: "Hudud",
    address: "Manzil va tilakni bitta xabarda yozing.",
    urgent: "Qachon",
    today: "Bugun",
    later: "Sanaga",
    slot: "Vaqt",
    morning: "Ertalab",
    day: "Kun",
    evening: "Kechqurun",
    human: "Odam",
    back: "Orqaga",
    done: "To'lovga",
  },
};

export function emptyDraft(): CheckoutDraft {
  return {
    lang: null,
    country: null,
    payMethod: null,
    fulfillment: null,
    date: null,
    zone: null,
    address: null,
    urgency: null,
    slot: null,
  };
}

function L(draft: CheckoutDraft) {
  return TEXT[draft.lang ?? "ru"];
}

function stepOf(draft: CheckoutDraft, shop: CheckoutShop): string {
  if (!draft.lang) return "lang";
  if (!draft.country) return "country";
  if (!draft.payMethod) return "pay";
  if (!shop.physical) return "done";
  if (!draft.fulfillment) return "get";
  if (shop.flowers && !draft.urgency) return "urgent";
  if (shop.flowers && draft.urgency === "later" && !draft.slot) return "slot";
  if (!draft.date) return "date";
  if (draft.fulfillment === "delivery" && !draft.zone) return "zone";
  if (draft.fulfillment === "delivery" && !draft.address) return "address";
  return "done";
}

function buttonsOf(step: string, draft: CheckoutDraft, shop: CheckoutShop): CardButton[] {
  const t = L(draft);
  const back: CardButton = { label: t.back, data: "back" };
  const human: CardButton = { label: t.human, data: "human" };
  if (step === "lang") {
    return CARD_LANGS.map((code) => ({ label: LANG_LABEL[code], data: `lang:${code}` }));
  }
  if (step === "country") {
    return [
      ...shop.countries.map((c) => ({
        label: c.label[draft.lang ?? "ru"],
        data: `country:${c.id}`,
      })),
      back,
      human,
    ];
  }
  if (step === "pay") {
    return [
      ...shop.payMethods.map((c) => ({ label: c.label[draft.lang ?? "ru"], data: `pay:${c.id}` })),
      back,
      human,
    ];
  }
  if (step === "get") {
    return [
      { label: t.pickup, data: "get:pickup" },
      { label: t.delivery, data: "get:delivery" },
      back,
    ];
  }
  if (step === "urgent") {
    return [
      { label: t.today, data: "urgent:today" },
      { label: t.later, data: "urgent:later" },
      back,
    ];
  }
  if (step === "slot") {
    return [
      { label: t.morning, data: "slot:morning" },
      { label: t.day, data: "slot:day" },
      { label: t.evening, data: "slot:evening" },
      back,
    ];
  }
  if (step === "date") {
    const dates = shop.dates.filter((d) => d >= shop.minDate);
    return [...dates.map((d) => ({ label: d, data: `date:${d}` })), back];
  }
  if (step === "zone") {
    return [
      ...shop.zones.map((z) => ({ label: z.label[draft.lang ?? "ru"], data: `zone:${z.id}` })),
      back,
    ];
  }
  return [back, human];
}

export function checkoutView(draft: CheckoutDraft, shop: CheckoutShop): CheckoutView {
  const step = stepOf(draft, shop);
  const t = L(draft);
  const done = step === "done";
  return {
    draft,
    needText: step === "address",
    done,
    handoff: false,
    card: {
      screen: "checkout",
      text: done ? t.done : (t[step as keyof Phrase] ?? step),
      buttons: done ? [{ label: t.done, data: "done" }] : buttonsOf(step, draft, shop),
    },
  };
}

function clearLast(draft: CheckoutDraft, shop: CheckoutShop): CheckoutDraft {
  const step = stepOf(draft, shop);
  const next = { ...draft };
  if (step === "country") next.lang = null;
  else if (step === "pay") next.country = null;
  else if (step === "get" || (step === "done" && !shop.physical)) next.payMethod = null;
  else if (step === "urgent") next.fulfillment = null;
  else if (step === "slot") next.urgency = null;
  else if (step === "date") {
    if (shop.flowers && draft.urgency === "later") next.slot = null;
    else if (shop.flowers) next.urgency = null;
    else next.fulfillment = null;
  } else if (step === "zone") next.date = null;
  else if (step === "address") next.zone = null;
  else if (step === "done" && draft.fulfillment === "delivery") next.address = null;
  else if (step === "done") next.date = null;
  return next;
}

export function pressCheckout(
  draft: CheckoutDraft,
  data: string,
  shop: CheckoutShop,
): CheckoutView {
  if (data === "human") {
    const view = checkoutView(draft, shop);
    return { ...view, handoff: true };
  }
  if (data === "back") return checkoutView(clearLast(draft, shop), shop);
  const next = { ...draft };
  if (data.startsWith("lang:") && (CARD_LANGS as readonly string[]).includes(data.slice(5))) {
    next.lang = data.slice(5) as CardLang;
  } else if (data.startsWith("country:") && shop.countries.some((c) => c.id === data.slice(8))) {
    next.country = data.slice(8);
  } else if (data.startsWith("pay:") && shop.payMethods.some((c) => c.id === data.slice(4))) {
    next.payMethod = data.slice(4);
  } else if (data === "get:pickup" || data === "get:delivery") {
    next.fulfillment = data.slice(4) as "pickup" | "delivery";
  } else if (data === "urgent:today" || data === "urgent:later") {
    next.urgency = data.slice(7) as "today" | "later";
  } else if (data === "slot:morning" || data === "slot:day" || data === "slot:evening") {
    next.slot = data.slice(5) as CheckoutDraft["slot"];
  } else if (data.startsWith("date:")) {
    const date = data.slice(5);
    if (date >= shop.minDate && shop.dates.includes(date)) next.date = date;
  } else if (data.startsWith("zone:") && shop.zones.some((z) => z.id === data.slice(5))) {
    next.zone = data.slice(5);
  }
  return checkoutView(next, shop);
}

/** Текст принимается только на шаге адреса. Остальное остаётся на кнопках. */
export function typeCheckout(draft: CheckoutDraft, text: string, shop: CheckoutShop): CheckoutView {
  const view = checkoutView(draft, shop);
  const trimmed = text.trim();
  if (!view.needText || !trimmed) return view;
  return checkoutView({ ...draft, address: trimmed }, shop);
}
