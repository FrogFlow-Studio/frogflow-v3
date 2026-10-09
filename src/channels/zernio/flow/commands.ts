import { REORDER_WORDS } from "@/core/orders/reorder-words";

/** Прямые команды покупателя. */

export type DirectCommand =
  | "catalog"
  | "cart"
  | "checkout"
  | "orders"
  | "points"
  | "language"
  | "country"
  | "quiz"
  | "reorder";

const COMMANDS: Array<[DirectCommand, string[]]> = [
  ["reorder", [...REORDER_WORDS]],
  [
    "quiz",
    [
      "подбор",
      "подобрать",
      "подбор товара",
      "подобрать товар",
      "квиз",
      "іріктеу",
      "тауар таңдау",
      "quiz",
      "find a product",
      "pick for me",
      "kviz",
      "tanlash",
      "mahsulot tanlash",
    ],
  ],
  [
    "catalog",
    [
      "/start",
      "start",
      "старт",
      "меню",
      "каталог",
      "магазин",
      "товары",
      "материалы",
      "начать",
      "бастау",
      "мәзір",
      "дүкен",
      "тауарлар",
      "материалдар",
      "menu",
      "catalog",
      "store",
      "products",
      "materials",
      "boshlash",
      "menyu",
      "do'kon",
      "do‘kon",
      "tovarlar",
      "materiallar",
    ],
  ],
  [
    "cart",
    [
      "корзина",
      "корзину",
      "моя корзина",
      "что в корзине",
      "что у меня в корзине",
      "себет",
      "себетке",
      "менің себетім",
      "себетімде не бар",
      "cart",
      "my cart",
      "what is in my cart",
      "savat",
      "savatga",
      "mening savatim",
      "savatimda nima bor",
    ],
  ],
  [
    "checkout",
    [
      "оформить",
      "оформить заказ",
      "оформляем",
      "оплатить",
      "оплата",
      "хочу оплатить",
      "как оплатить",
      "к оплате",
      "реквизиты",
      "тапсырысты рәсімдеу",
      "тапсырыс рәсімдеу",
      "төлеу",
      "төлем",
      "қалай төлеуге болады",
      "төлем деректемелері",
      "place order",
      "checkout",
      "pay",
      "payment",
      "how to pay",
      "payment details",
      "buyurtma berish",
      "buyurtmani rasmiylashtirish",
      "rasmiylashtirish",
      "to'lash",
      "to‘lash",
      "to'lov",
      "to‘lov",
      "qanday to'lash",
      "qanday to‘lash",
      "to'lov rekvizitlari",
      "to‘lov rekvizitlari",
    ],
  ],
  [
    "orders",
    [
      "мои заказы",
      "заказы",
      "мой заказ",
      "где мой заказ",
      "статус заказа",
      "менің тапсырыстарым",
      "тапсырыстар",
      "менің тапсырысым",
      "тапсырыс күйі",
      "my orders",
      "my order",
      "order status",
      "buyurtmalarim",
      "buyurtmalar",
      "buyurtmam",
      "buyurtma holati",
    ],
  ],
  [
    "points",
    [
      "баллы",
      "мои баллы",
      "сколько баллов",
      "бонусы",
      "мои бонусы",
      "ұпай",
      "ұпайлар",
      "менің ұпайларым",
      "қанша ұпай",
      "points",
      "my points",
      "how many points",
      "ball",
      "ballar",
      "mening ballarim",
      "ballarim",
      "nechta ball",
    ],
  ],
  ["language", ["язык", "тіл", "til", "language", "/language"]],
  ["country", ["страна", "ел", "country", "давлат", "/country", "валюта", "сменить страну"]],
];

/**
 * Команды сравниваются с целым сообщением: по вхождению «Я оплатила 400тг,
 * материал не отправили» становилось командой «оформить» и получало «Корзина
 * пуста».
 */
export function matchDirectCommand(text: string): DirectCommand | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/^[«"]+|[»"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  for (const [command, words] of COMMANDS) if (words.includes(normalized)) return command;
  return null;
}
