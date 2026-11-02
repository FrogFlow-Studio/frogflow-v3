import { serverFailure } from "@/lib/server-failure";
import type { CaseKind } from "../core/cases/cases";
import type { V4Db } from "../core/db";

/**
 * Экраны «Сегодня» (продавец) и «Внимание» (оператор), этап 5. Данные —
 * одним вызовом SQL (migrations/v4/007-screens.sql), здесь — карточки:
 * заголовок, светофор и две кнопки-действия на каждое дело. Строки продавцу —
 * на 4 языках (CLAUDE.md). Кнопки — идентификаторы действий; что делает
 * каждое, решает серверная функция панели (этап 6), не текст.
 */

export type SellerLang = "ru" | "kk" | "en" | "uz";
export type Light = "red" | "yellow" | "green";

export const CASE_ACTIONS = [
  "receipt_accept",
  "receipt_reject",
  "reply_buyer",
  "return_to_bot",
  "payment_settings",
  "open_order",
  "close_case",
  "retry_delivery",
  "top_up_ai",
  "check_channel",
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

type L = Record<SellerLang, string>;

/** Вид дела → заголовок и две кнопки. Тест проверяет, что все 12 видов здесь есть. */
export const CASE_CARDS: Record<
  CaseKind,
  { title: L; primary: CaseAction; secondary: CaseAction }
> = {
  receipt_review: {
    title: {
      ru: "Прислали чек — проверьте поступление",
      kk: "Чек жіберілді — түскенін тексеріңіз",
      en: "Receipt sent — check the payment arrived",
      uz: "Chek yuborildi — tushumni tekshiring",
    },
    primary: "receipt_accept",
    secondary: "receipt_reject",
  },
  handoff: {
    title: {
      ru: "Покупатель ждёт вашего ответа",
      kk: "Сатып алушы жауабыңызды күтуде",
      en: "A buyer is waiting for your reply",
      uz: "Xaridor javobingizni kutmoqda",
    },
    primary: "reply_buyer",
    secondary: "return_to_bot",
  },
  cant_pay: {
    title: {
      ru: "Покупатель не может оплатить",
      kk: "Сатып алушы төлей алмайды",
      en: "A buyer can't pay",
      uz: "Xaridor to'lay olmayapti",
    },
    primary: "reply_buyer",
    secondary: "payment_settings",
  },
  underpaid: {
    title: {
      ru: "Оплатили меньше суммы заказа",
      kk: "Тапсырыс сомасынан аз төленді",
      en: "Paid less than the order total",
      uz: "Buyurtma summasidan kam to'landi",
    },
    primary: "open_order",
    secondary: "close_case",
  },
  payment_on_closed: {
    title: {
      ru: "Оплата пришла по закрытому заказу",
      kk: "Жабылған тапсырыс бойынша төлем келді",
      en: "Payment arrived for a closed order",
      uz: "Yopilgan buyurtma bo'yicha to'lov keldi",
    },
    primary: "open_order",
    secondary: "close_case",
  },
  currency_mismatch: {
    title: {
      ru: "Оплатили в другой валюте",
      kk: "Басқа валютада төленді",
      en: "Paid in a different currency",
      uz: "Boshqa valyutada to'landi",
    },
    primary: "open_order",
    secondary: "close_case",
  },
  chargeback: {
    title: {
      ru: "Банк отменил оплату картой",
      kk: "Банк картамен төлемді болдырмады",
      en: "The bank reversed a card payment",
      uz: "Bank karta to'lovini bekor qildi",
    },
    primary: "open_order",
    secondary: "close_case",
  },
  delivery_failed: {
    title: {
      ru: "Материал не дошёл до покупателя",
      kk: "Материал сатып алушыға жетпеді",
      en: "The item didn't reach the buyer",
      uz: "Material xaridorga yetib bormadi",
    },
    primary: "retry_delivery",
    secondary: "reply_buyer",
  },
  notify_failed: {
    title: {
      ru: "Уведомление не дошло",
      kk: "Хабарлама жетпеді",
      en: "A notification wasn't delivered",
      uz: "Bildirishnoma yetib bormadi",
    },
    primary: "open_order",
    secondary: "close_case",
  },
  ai_limit: {
    title: {
      ru: "ИИ-лимит месяца закончился — бот отвечает простыми ответами",
      kk: "Айлық ЖИ лимиті бітті — бот қарапайым жауап береді",
      en: "Monthly AI limit is used up — the bot sends simple replies",
      uz: "Oylik SI limiti tugadi — bot oddiy javob beradi",
    },
    primary: "top_up_ai",
    secondary: "close_case",
  },
  channel_down: {
    title: {
      ru: "Канал молчит — проверьте подключение",
      kk: "Арна үнсіз — қосылымды тексеріңіз",
      en: "A channel has gone quiet — check the connection",
      uz: "Kanal jim — ulanishni tekshiring",
    },
    primary: "check_channel",
    secondary: "close_case",
  },
  seller_request: {
    title: {
      ru: "Обращение продавца в платформу",
      kk: "Сатушының платформаға өтініші",
      en: "Seller request to the platform",
      uz: "Sotuvchining platformaga murojaati",
    },
    primary: "reply_buyer",
    secondary: "close_case",
  },
};

export const ACTION_LABELS: Record<CaseAction, L> = {
  receipt_accept: { ru: "Деньги пришли", kk: "Ақша түсті", en: "Money arrived", uz: "Pul tushdi" },
  receipt_reject: { ru: "Не пришли", kk: "Түспеді", en: "Not received", uz: "Tushmadi" },
  reply_buyer: { ru: "Ответить", kk: "Жауап беру", en: "Reply", uz: "Javob berish" },
  return_to_bot: {
    ru: "Вернуть боту",
    kk: "Ботқа қайтару",
    en: "Back to bot",
    uz: "Botga qaytarish",
  },
  payment_settings: {
    ru: "Способы оплаты",
    kk: "Төлем тәсілдері",
    en: "Payment methods",
    uz: "To'lov usullari",
  },
  open_order: {
    ru: "Открыть заказ",
    kk: "Тапсырысты ашу",
    en: "Open order",
    uz: "Buyurtmani ochish",
  },
  close_case: { ru: "Закрыть", kk: "Жабу", en: "Close", uz: "Yopish" },
  retry_delivery: {
    ru: "Отправить снова",
    kk: "Қайта жіберу",
    en: "Send again",
    uz: "Qayta yuborish",
  },
  top_up_ai: { ru: "Пополнить", kk: "Толтыру", en: "Top up", uz: "To'ldirish" },
  check_channel: {
    ru: "Проверить канал",
    kk: "Арнаны тексеру",
    en: "Check channel",
    uz: "Kanalni tekshirish",
  },
};

const ORDER: Record<SellerLang, string> = {
  ru: "Заказ",
  kk: "Тапсырыс",
  en: "Order",
  uz: "Buyurtma",
};

export type CaseCard = {
  id: string;
  kind: CaseKind;
  light: Light;
  title: string;
  /** «Заказ №274 · Мария» — что есть. */
  subject: string | null;
  openedAt: Date;
  dueAt: Date | null;
  orderId: string | null;
  buyerId: string | null;
  primary: { action: CaseAction; label: string };
  secondary: { action: CaseAction; label: string };
};

export type TodayScreen = {
  cards: CaseCard[];
  botDid: {
    since: Date;
    orders: number;
    paid: number;
    delivered: number;
    commentsAnswered: number;
  };
  aiRoomMicroUsd: number;
};

type Row = Record<string, unknown>;

function card(r: Row, lang: SellerLang): CaseCard {
  const kind = r.kind as CaseKind;
  const def = CASE_CARDS[kind];
  if (!def) throw serverFailure(`v4 screens: неизвестный вид дела ${String(r.kind)}`);
  const parts = [
    r.order_no != null ? `${ORDER[lang]} №${Number(r.order_no)}` : null,
    typeof r.buyer_name === "string" && r.buyer_name ? r.buyer_name : null,
  ].filter((x): x is string => x !== null);
  return {
    id: String(r.id),
    kind,
    light: r.light as Light,
    title: def.title[lang],
    subject: parts.length ? parts.join(" · ") : null,
    openedAt: new Date(r.created_at as string),
    dueAt: r.due_at ? new Date(r.due_at as string) : null,
    orderId: (r.order_id as string | null) ?? null,
    buyerId: (r.buyer_id as string | null) ?? null,
    primary: { action: def.primary, label: ACTION_LABELS[def.primary][lang] },
    secondary: { action: def.secondary, label: ACTION_LABELS[def.secondary][lang] },
  };
}

export async function today(
  db: V4Db,
  botId: string,
  lang: SellerLang = "ru",
  now?: Date,
): Promise<TodayScreen> {
  const args: Record<string, unknown> = { p_bot_id: botId };
  if (now) args.p_now = now.toISOString();
  const r = (await db.call("today", args))[0]?.today as Row | undefined;
  if (!r) throw serverFailure("v4.today: пустой ответ");
  const did = r.bot_did as Row;
  return {
    cards: (r.cases as Row[]).map((c) => card(c, lang)),
    botDid: {
      since: new Date(did.since as string),
      orders: Number(did.orders),
      paid: Number(did.paid),
      delivered: Number(did.delivered),
      commentsAnswered: Number(did.comments_answered),
    },
    aiRoomMicroUsd: Number(r.ai_room_micro_usd),
  };
}

export type AttentionScreen = {
  cases: Array<{
    id: string;
    botId: string;
    kind: CaseKind;
    light: Light;
    title: string;
    orderNo: number | null;
    openedAt: Date;
  }>;
  shops: Array<{
    botId: string;
    light: Light;
    openCases: number;
    orders2d: number;
    aiRoomMicroUsd: number;
  }>;
};

/** Экран оператора (только сервисная роль). Оператор читает по-русски. */
export async function attention(db: V4Db, now?: Date): Promise<AttentionScreen> {
  const args: Record<string, unknown> = {};
  if (now) args.p_now = now.toISOString();
  const r = (await db.call("attention", args))[0]?.attention as Row | undefined;
  if (!r) throw serverFailure("v4.attention: пустой ответ");
  return {
    cases: (r.cases as Row[]).map((c) => ({
      id: String(c.id),
      botId: String(c.bot_id),
      kind: c.kind as CaseKind,
      light: c.light as Light,
      title: CASE_CARDS[c.kind as CaseKind]?.title.ru ?? String(c.kind),
      orderNo: c.order_no != null ? Number(c.order_no) : null,
      openedAt: new Date(c.created_at as string),
    })),
    shops: (r.shops as Row[]).map((s) => ({
      botId: String(s.bot_id),
      light: s.light as Light,
      openCases: Number(s.open_cases),
      orders2d: Number(s.orders_2d),
      aiRoomMicroUsd: Number(s.ai_room_micro_usd),
    })),
  };
}
