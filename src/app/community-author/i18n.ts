import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";

/** Публичная страница автора (С6) и блок «Рекомендуем» на витрине: ru, kk, en, uz. */
const ru = {
  "meta.title": "{name} — автор на FrogFlow",
  "meta.description": "Автор {name} на FrogFlow: чем занимается, что продаёт и отзывы покупателей.",
  about: "Об авторе",
  "niche.city": "{niche}, {city}",
  sells: "Что продаю",
  "sells.empty": "Витрина пока без товаров.",
  "sells.more": "И другие товары — в витрине.",
  rating: "Оценка покупателей: {rating} из 5, оценок: {count}",
  "rating.none": "Пока без оценок.",
  "rating.hint": "Оценка по одобренным отзывам; показывается, пока магазин на площадке FrogFlow.",
  links: "Ссылки",
  recommends: "Рекомендуют друг друга",
  "recommends.hint": "Эти магазины рекомендуют друг друга по согласию обоих авторов.",
  open: "Открыть витрину",
  home: "На главную",
  "recs.title": "Рекомендуем",
  "recs.open": "Открыть магазин",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "{name} — FrogFlow авторы",
  "meta.description":
    "FrogFlow авторы {name}: немен айналысады, не сатады және сатып алушылардың пікірлері.",
  about: "Автор туралы",
  "niche.city": "{niche}, {city}",
  sells: "Не сатамын",
  "sells.empty": "Витринада әзірге тауар жоқ.",
  "sells.more": "Басқа тауарлар — витринада.",
  rating: "Сатып алушылар бағасы: 5-тен {rating}, бағалар: {count}",
  "rating.none": "Әзірге бағасыз.",
  "rating.hint": "Бекітілген пікірлер бойынша баға; дүкен FrogFlow алаңында тұрғанда көрсетіледі.",
  links: "Сілтемелер",
  recommends: "Бір-бірін ұсынады",
  "recommends.hint": "Бұл дүкендер екі автордың келісімімен бір-бірін ұсынады.",
  open: "Витринаны ашу",
  home: "Басты бетке",
  "recs.title": "Ұсынамыз",
  "recs.open": "Дүкенді ашу",
};

const en: Record<Key, string> = {
  "meta.title": "{name} — author on FrogFlow",
  "meta.description":
    "Author {name} on FrogFlow: what they do, what they sell and what buyers say.",
  about: "About the author",
  "niche.city": "{niche}, {city}",
  sells: "What I sell",
  "sells.empty": "The storefront has no products yet.",
  "sells.more": "More products are in the storefront.",
  rating: "Buyer rating: {rating} out of 5, ratings: {count}",
  "rating.none": "No ratings yet.",
  "rating.hint":
    "Rating from approved reviews; shown while the shop is on the FrogFlow marketplace.",
  links: "Links",
  recommends: "Recommend each other",
  "recommends.hint": "These shops recommend each other, with both authors' consent.",
  open: "Open storefront",
  home: "Home",
  "recs.title": "We recommend",
  "recs.open": "Open shop",
};

const uz: Record<Key, string> = {
  "meta.title": "{name} — FrogFlow muallifi",
  "meta.description":
    "FrogFlow muallifi {name}: nima bilan shugʻullanadi, nima sotadi va xaridorlar fikri.",
  about: "Muallif haqida",
  "niche.city": "{niche}, {city}",
  sells: "Nima sotaman",
  "sells.empty": "Vitrinada hozircha tovar yoʻq.",
  "sells.more": "Boshqa tovarlar — vitrinada.",
  rating: "Xaridorlar bahosi: 5 dan {rating}, baholar: {count}",
  "rating.none": "Hozircha baholarsiz.",
  "rating.hint":
    "Tasdiqlangan fikrlar boʻyicha baho; doʻkon FrogFlow maydonida turgan paytda koʻrsatiladi.",
  links: "Havolalar",
  recommends: "Bir-birini tavsiya qiladi",
  "recommends.hint": "Bu doʻkonlar ikkala muallifning roziligi bilan bir-birini tavsiya qiladi.",
  open: "Vitrinani ochish",
  home: "Bosh sahifaga",
  "recs.title": "Tavsiya qilamiz",
  "recs.open": "Doʻkonni ochish",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export function authorT(locale: Locale) {
  const d = DICTS[locale] ?? ru;
  return (key: Key, vars?: UserErrorVars) => fill(d[key] ?? ru[key], vars);
}
export const AUTHOR_KEYS = Object.keys(ru) as Key[];
export const AUTHOR_DICTS = DICTS;
