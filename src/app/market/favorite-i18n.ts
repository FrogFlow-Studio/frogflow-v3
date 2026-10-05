import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";

/** Избранное покупателя на площадке (К1) на 4 языках. Русский — источник ключей. */
const ru = {
  title: "Избранное с площадки",
  hint: "Товары из разных магазинов, которые вы отметили сердечком. Цена и наличие — как сейчас на витрине.",
  empty: "Пока ничего не отмечено. Нажмите сердечко у товара в «Все товары».",
  gone: "Сейчас недоступны (закончились или магазин скрыт): {n}.",
  soon: "Избранное на площадке скоро заработает.",
  add: "В избранное",
  remove: "Убрать из избранного",
  signin: "Войдите через любой магазин площадки, чтобы сохранять товары.",
  full: "В избранном уже {n} товаров. Уберите лишнее, чтобы добавить новое.",
  unknown: "Этого товара на площадке уже нет.",
  failed: "Не получилось. Попробуйте ещё раз.",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  title: "Алаңнан таңдаулылар",
  hint: "Әртүрлі дүкендердегі жүрекшемен белгілеген тауарлар. Баға мен қолда бары — витринадағыдай.",
  empty: "Әзір ештеңе белгіленбеген. «Барлық тауарлар» бөлімінде тауардағы жүрекшені басыңыз.",
  gone: "Қазір қолжетімсіз (таусылған немесе дүкен жасырылған): {n}.",
  soon: "Алаңдағы таңдаулылар жақында іске қосылады.",
  add: "Таңдаулыға",
  remove: "Таңдаулыдан алып тастау",
  signin: "Тауарларды сақтау үшін алаңның кез келген дүкені арқылы кіріңіз.",
  full: "Таңдаулыда {n} тауар бар. Жаңасын қосу үшін артығын алып тастаңыз.",
  unknown: "Бұл тауар алаңда енді жоқ.",
  failed: "Болмады. Қайталап көріңіз.",
};

const en: Record<Key, string> = {
  title: "Favourites from the marketplace",
  hint: "Items from different shops that you marked with a heart. Price and availability are as on the shop page right now.",
  empty: "Nothing marked yet. Tap the heart on an item in “All items”.",
  gone: "Not available right now (sold out or the shop is hidden): {n}.",
  soon: "Marketplace favourites will be available soon.",
  add: "Add to favourites",
  remove: "Remove from favourites",
  signin: "Sign in through any shop on the marketplace to save items.",
  full: "You already have {n} items in favourites. Remove some to add new ones.",
  unknown: "This item is no longer on the marketplace.",
  failed: "That did not work. Please try again.",
};

const uz: Record<Key, string> = {
  title: "Maydondagi tanlanganlar",
  hint: "Turli doʻkonlardan yurakcha bilan belgilagan mahsulotlaringiz. Narx va mavjudlik — hozir vitrinadagidek.",
  empty:
    "Hozircha hech narsa belgilanmagan. «Barcha mahsulotlar»da mahsulotdagi yurakchani bosing.",
  gone: "Hozir mavjud emas (tugagan yoki doʻkon yashirilgan): {n}.",
  soon: "Maydondagi tanlanganlar tez orada ishga tushadi.",
  add: "Tanlanganlarga",
  remove: "Tanlanganlardan olib tashlash",
  signin: "Mahsulotlarni saqlash uchun maydonning istalgan doʻkoni orqali kiring.",
  full: "Tanlanganlarda {n} ta mahsulot bor. Yangisini qoʻshish uchun ortiqchasini olib tashlang.",
  unknown: "Bu mahsulot maydonda endi yoʻq.",
  failed: "Bajarilmadi. Qayta urinib koʻring.",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export type FavoriteKey = Key;
export const FAVORITE_KEYS = Object.keys(ru) as Key[];

export function favoriteT(locale: Locale) {
  const d = DICTS[locale] ?? ru;
  return (key: Key, vars?: UserErrorVars) => fill(d[key] ?? ru[key], vars);
}
