/**
 * Золотые диалоги функций ботов 19-й (Д1, партия 20): «позвать продавца», «как в
 * прошлый раз», трек-номер из Telegram, «почему бот так ответил». Каждая функция —
 * в каналах, где она есть, и на ru, kk, uz: ответ по делу, не молчит там, где
 * должен ответить, не чужой язык, не дублирует. Типы — из scenarios.ts (только
 * типы, чтобы не было цикла импорта).
 */
import type { Locale } from "@/core/i18n/locale";
import type { Channel, Product, Room } from "./harness";
import type { Scenario } from "./scenarios";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const GOODS: Product[] = [
  { id: A, name: "018. Прописи" },
  { id: B, name: "019. Пазлы" },
];
const LOCALES: Locale[] = ["ru", "kk", "uz"];
const SUFFIX: Record<Channel, string> = { telegram: "tg", instagram: "ig", whatsapp: "wa" };

function each(
  id: string,
  channels: Channel[],
  make: (l: Locale, channel: Channel) => Omit<Scenario, "id" | "channel" | "locale">,
): Scenario[] {
  return channels.flatMap((channel) =>
    LOCALES.map((locale) => ({
      ...make(locale, channel),
      id: `${id}-${SUFFIX[channel]}-${locale}`,
      channel,
      locale,
    })),
  );
}

/** Слово «позови человека» на каждом языке и ответ покупателю (human-call.ts). */
const CALL: Record<Locale, { word: string; reply: string; question: string }> = {
  ru: { word: "человек", reply: "Позвал продавца", question: "а есть в синем цвете?" },
  kk: { word: "тірі адам", reply: "Сатушыны шақырдым", question: "көк түсі бар ма?" },
  uz: { word: "jonli odam", reply: "Sotuvchini chaqirdim", question: "ko‘k rangi bormi?" },
  en: { word: "human", reply: "called the seller", question: "is there a blue one?" },
};

/** «Как в прошлый раз» на каждом языке (reorder-words.ts). */
const AGAIN: Record<Locale, string> = {
  ru: "как в прошлый раз",
  kk: "өткен жолғыдай",
  uz: "oldingidek",
  en: "same as last time",
};

/** Трек-номер из Telegram: подпись номера в сообщении покупателю на его языке. */
const TRACK: Record<Locale, string> = {
  ru: "Трек-номер: 1234567890 (СДЭК)",
  kk: "Трек-нөмір: 1234567890 (СДЭК)",
  uz: "Trek-raqam: 1234567890 (СДЭК)",
  en: "Tracking number: 1234567890 (СДЭК)",
};

const talking = { direct: { last_reply: "Каталог", last_reply_at: new Date().toISOString() } };

/** Заказ покупателя этого диалога: оплаченный (в нём два товара) или физический «собран». */
function seedOrder(r: Room, o: { id: number; status: string; physical?: boolean }) {
  const buyer = r.db.tables.bot_users![0]!;
  r.db.tables.orders!.push({
    id: o.id,
    order_no: o.id,
    display_no: o.id,
    bot_id: "00000000-0000-4000-8000-0000000000aa",
    telegram_id: buyer.telegram_id,
    user_key: buyer.user_key,
    platform: buyer.platform,
    status: o.status,
    total: 2000,
    currency: "KZT",
    fulfillment_kind: o.physical ? "physical" : "digital",
    created_at: "2026-09-20T10:00:00Z",
    order_items: [A, B].map((id, i) => ({
      id: `i${o.id}${i}`,
      product_id: id,
      product_variant_id: null,
      name_snapshot: GOODS[i]!.name,
      quantity: 1,
      price_snapshot: 1000,
    })),
  });
}

export const BOTS_20: Scenario[] = [
  // ───── «Позвать продавца» (Б9): Direct и WhatsApp; в Telegram покупатель и так пишет боту магазина ─────
  ...each("call-human", ["instagram", "whatsapp"], (l) => ({
    title:
      "слово «позови человека»: один ответ на языке покупателя, продавцу одна карточка, повтор молчит",
    origin: "Б9 / Д1",
    products: GOODS,
    full: true,
    steps: [
      {
        say: { text: CALL[l].word },
        expect: { says: [CALL[l].reply], count: 1, sellerNotices: 1 },
      },
      { say: { repeat: true }, expect: { silent: true, sellerNotices: 0 } },
      // Пауза бота: обычный вопрос — продавцу, бот молчит; явная команда «каталог» работает.
      { say: { text: CALL[l].question }, expect: { silent: true } },
      { say: { text: "каталог" }, expect: { count: 1 } },
    ],
  })),
  {
    id: "call-human-long-question-ig-ru",
    title: "«человек» внутри длинного вопроса — не вызов продавца",
    origin: "Б9 / Д1",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: GOODS,
    steps: [
      {
        say: { text: "сколько человек можно записать на занятие в субботу?" },
        expect: { notSays: ["Позвал продавца"], sellerNotices: 0 },
      },
    ],
  },
  // ───── «Как в прошлый раз» (Б11): все три канала ─────
  ...each("reorder", ["telegram", "instagram", "whatsapp"], (l) => ({
    title:
      "«как в прошлый раз»: оба товара из оплаченного заказа в корзине, ответ на языке покупателя",
    origin: "Б11 / Д1",
    products: GOODS,
    state: talking,
    arrange: (r) => seedOrder(r, { id: 5, status: "delivered" }),
    steps: [
      {
        say: { text: AGAIN[l] },
        expect: { says: [(c) => c.reorderDone(2)], cart: 2 },
      },
      // Двойная доставка слова не удваивает корзину.
      { say: { repeat: true }, expect: { cart: 2 } },
    ],
  })),
  ...each("reorder-none", ["telegram", "instagram", "whatsapp"], (l) => ({
    title: "«как в прошлый раз» без оплаченных заказов: честный ответ и каталог, не молчание",
    origin: "Б11 / Д1",
    products: GOODS,
    state: talking,
    steps: [{ say: { text: AGAIN[l] }, expect: { says: [(c) => c.reorderNoPaid], cart: 0 } }],
  })),
  {
    id: "reorder-unpaid-tg-ru",
    title: "неоплаченный (ожидает оплаты) заказ повтором не служит",
    origin: "Б11 / Д1",
    channel: "telegram",
    locale: "ru",
    products: GOODS,
    arrange: (r) => seedOrder(r, { id: 6, status: "awaiting_payment" }),
    steps: [{ say: { text: AGAIN.ru }, expect: { says: [(c) => c.reorderNoPaid], cart: 0 } }],
  },
  // ───── Трек-номер из Telegram продавца (Б12): покупатель в любом из трёх каналов ─────
  ...each("track", ["telegram", "instagram", "whatsapp"], (l) => ({
    title:
      "продавец ответил номером: покупателю один трек на его языке, повтор того же номера молчит",
    origin: "Б12 / Д1",
    products: GOODS,
    arrange: (r) => seedOrder(r, { id: 7, status: "ready", physical: true }),
    steps: [
      {
        say: { sellerTrack: "1234567890", orderId: 7 },
        expect: {
          says: [TRACK[l], "https://www.cdek.ru/ru/tracking?order_id=1234567890"],
          count: 1,
        },
      },
      {
        say: { sellerTrack: "1234567890", orderId: 7 },
        expect: { silent: true, sellerSees: ["второго сообщения нет"] },
      },
    ],
  })),
  {
    id: "track-foreign-number-ig-ru",
    title: "чужой формат номера — покупателю номер текстом, ссылки на службу нет",
    origin: "Б12 / Д2",
    channel: "instagram",
    locale: "ru",
    arrange: (r) => seedOrder(r, { id: 8, status: "ready", physical: true }),
    steps: [
      {
        say: { sellerTrack: "AB-77-XYZ-99", orderId: 8 },
        expect: { says: ["Трек-номер: AB-77-XYZ-99"], notSays: ["http"], count: 1 },
      },
    ],
  },
  // ───── Д2: граничные номера — ссылка только СДЭК (10 цифр) и Казпочте ─────
  ...["123456789", "12345678901"].flatMap((n) =>
    (["telegram", "instagram", "whatsapp"] as Channel[]).map((channel): Scenario => ({
      id: `track-edge-${n.length}-${SUFFIX[channel]}-ru`,
      title: `номер из ${n.length} цифр — не СДЭК: номер текстом, без ссылки и без названия службы`,
      origin: "Д2",
      channel,
      locale: "ru",
      arrange: (r) => seedOrder(r, { id: 9, status: "ready", physical: true }),
      steps: [
        {
          say: { sellerTrack: n, orderId: 9 },
          expect: { says: [`Трек-номер: ${n}`], notSays: ["http", "СДЭК", "Казпочта"], count: 1 },
        },
      ],
    })),
  ),
  {
    id: "track-kazpost-spaces-wa-uz",
    title: "Казпочта строчными буквами с пробелами — номер приведён, ссылка на сайт Казпочты",
    origin: "Д2",
    channel: "whatsapp",
    locale: "uz",
    arrange: (r) => seedOrder(r, { id: 10, status: "ready", physical: true }),
    steps: [
      {
        say: { sellerTrack: "rr 123456789 kz", orderId: 10 },
        expect: { says: ["Trek-raqam: RR123456789KZ (Казпочта)", "https://post.kz/"], count: 1 },
      },
    ],
  },
  // ───── «Почему бот так ответил» (Б13): причина пишется вместе с ответом, ответ не меняется ─────
  ...each("reason", ["instagram", "whatsapp"], () => ({
    title: "при включённом «Чате» ответ бота идёт как обычно и несёт причину без текста покупателя",
    origin: "Б13 / Д1",
    products: GOODS,
    modules: { manager_chat: true },
    steps: [{ say: { text: "каталог" }, expect: { count: 1, reasons: 1 } }],
  })),
];
