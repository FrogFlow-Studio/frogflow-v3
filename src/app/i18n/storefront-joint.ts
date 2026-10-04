import type { Locale } from "@/core/i18n/locale";

/**
 * «Акция партнёров» на витрине (С5): тексты покупателя на ru, kk, en, uz. Отдельный маленький
 * словарь, чтобы не трогать общий словарь витрины.
 */
const ru = {
  "joint.title": "Акция партнёров",
  "joint.until": "до {date}",
  "joint.here": "В этом магазине: промокод {code}, скидка {percent} %.",
  "joint.there": "В магазине «{name}»: промокод {code}, скидка {percent} %.",
  "joint.open": "Открыть магазин",
} as const;

type Dict = Record<keyof typeof ru, string>;

const kk: Dict = {
  "joint.title": "Серіктестер акциясы",
  "joint.until": "{date} дейін",
  "joint.here": "Осы дүкенде: {code} промокоды, {percent} % жеңілдік.",
  "joint.there": "«{name}» дүкенінде: {code} промокоды, {percent} % жеңілдік.",
  "joint.open": "Дүкенді ашу",
};

const en: Dict = {
  "joint.title": "Partner promotion",
  "joint.until": "until {date}",
  "joint.here": "In this shop: promo code {code}, {percent}% off.",
  "joint.there": "In “{name}”: promo code {code}, {percent}% off.",
  "joint.open": "Open the shop",
};

const uz: Dict = {
  "joint.title": "Hamkorlar aksiyasi",
  "joint.until": "{date} gacha",
  "joint.here": "Ushbu doʻkonda: {code} promokodi, {percent} % chegirma.",
  "joint.there": "«{name}» doʻkonida: {code} promokodi, {percent} % chegirma.",
  "joint.open": "Doʻkonni ochish",
};

const DICTS: Record<Locale, Dict> = { ru, kk, en, uz };

export function jointT(locale: Locale) {
  const dict = DICTS[locale] ?? ru;
  return (key: keyof typeof ru, vars?: Record<string, string | number>) => {
    let s = dict[key] ?? ru[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
