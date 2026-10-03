/**
 * Страницы главной под ниши: `/for/<ниша>` со своим заголовком для поиска и
 * рекламы. Тексты — в `src/app/i18n/landing.ts` (`niche.<ниша>.*`), тарифы —
 * те же, что на главной, из реестра планов (`PricingNiche` → core/plans).
 */
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { SIGNUP_PAGES, type SignupPage } from "@/core/signup/origin";
import type { VerticalKey } from "@/core/verticals/registry";
import { PLAN_TIERS, TRIAL_TIER } from "@/core/plans/registry";
import { articleSitemapLocs } from "./articles";
import { SITE_URL, landingUrl, moduleFromTier, type PlanKey, type PricingNiche } from "./config";

/** Те же ключи, что пишутся в bots.settings.signup.page (core/signup/origin). */
export const NICHE_PAGES = SIGNUP_PAGES;
export type NichePage = SignupPage;

/** Тарифы какой ниши показывает страница. */
export const NICHE_PRICING: Record<NichePage, PricingNiche> = {
  cakes: "cake",
  materials: "dig",
  // Курсы продают магазины цифровых товаров: это их тарифы, «Курсы» — строка в них.
  courses: "dig",
};

/** Что выбрано в «Что продаёте» при регистрации со страницы ниши. */
export const NICHE_VERTICAL: Record<NichePage, VerticalKey> = {
  cakes: "confectionery",
  materials: "digital",
  // Своя ниша «Онлайн-школа»: тексты бота под школу; тарифы — цифровых
  // товаров (core/plans nicheForVertical).
  courses: "courses",
};

export function isNichePage(v: unknown): v is NichePage {
  return typeof v === "string" && (NICHE_PAGES as readonly string[]).includes(v);
}

/**
 * С какого тарифа доступна страница «для курсов»: пока «Курсы» не входят ни в
 * один план (реестр: «отдельно» или «не продаём»), обещать их на отдельной
 * странице нечестно — страницы нет. Остальные страницы есть всегда.
 */
export function coursesFromTier(): PlanKey | null {
  return moduleFromTier(NICHE_PRICING.courses, "courses");
}

/**
 * Покрывает ли пробный период (TRIAL_TIER в реестре) то, что продаёт
 * страница. «Курсы» начинаются с тарифа выше пробного — на их странице
 * пробный период не обещаем.
 */
export function trialCoversNiche(page: NichePage): boolean {
  if (page !== "courses") return true;
  const from = coursesFromTier();
  return from !== null && PLAN_TIERS.indexOf(from) <= PLAN_TIERS.indexOf(TRIAL_TIER);
}

export function nichePageOpen(page: NichePage): boolean {
  return page !== "courses" || coursesFromTier() !== null;
}

/** Страницы, которые сейчас показываются (ссылки на главной и между собой). */
export function openNichePages(): NichePage[] {
  return NICHE_PAGES.filter(nichePageOpen);
}

/** Адрес страницы ниши на языке: русский — без параметра, как у главной. */
export function nichePageUrl(page: NichePage, locale: Locale): string {
  const base = `${SITE_URL}/for/${page}`;
  return locale === "ru" ? base : `${base}?lang=${locale}`;
}

/** Страницы платформы для карты сайта: главная и открытые страницы ниш на всех языках. */
export function landingSitemapLocs(): string[] {
  return [
    ...SUPPORTED_LOCALES.map(landingUrl),
    ...openNichePages().flatMap((p) => SUPPORTED_LOCALES.map((l) => nichePageUrl(p, l))),
    ...articleSitemapLocs(),
  ];
}
