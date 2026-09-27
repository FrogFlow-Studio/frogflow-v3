import { isWebSource } from "@/core/storefront/web-source";

/**
 * Откуда пришёл продавец, зарегистрировавшийся сам: utm и ref первой ссылки
 * на главную (та же строка `site:…`, что у покупателей витрины,
 * core/storefront/web-source) и страница ниши лендинга (`/for/<ниша>`).
 * Пишется в `bots.settings.signup` нового клиента, оператор видит её в
 * карточке клиента. Значения приходят из браузера — принимается только то,
 * что мог собрать сайт.
 */
export const SIGNUP_PAGES = ["cakes", "materials", "courses"] as const;
export type SignupPage = (typeof SIGNUP_PAGES)[number];

export type SignupOrigin = { source?: string; page?: SignupPage };

/** Ключ источника в браузере: у платформы нет slug, «__» в логине невозможен. */
export const PLATFORM_SOURCE_SLUG = "__platform";

export function signupOrigin(input: { source?: unknown; page?: unknown }): SignupOrigin | null {
  const out: SignupOrigin = {};
  if (isWebSource(input.source)) out.source = input.source;
  if (typeof input.page === "string" && (SIGNUP_PAGES as readonly string[]).includes(input.page))
    out.page = input.page as SignupPage;
  return out.source || out.page ? out : null;
}

const PAGE_TITLES: Record<SignupPage, string> = {
  cakes: "для кондитерских",
  materials: "для учебных материалов",
  courses: "для курсов",
};

/** Подпись для оператора: «метка google/spring · страница «для кондитерских»». */
export function signupOriginLabel(o: SignupOrigin | null | undefined): string | null {
  if (!o) return null;
  const parts: string[] = [];
  if (o.source && isWebSource(o.source)) parts.push(`метка ${o.source.slice("site:".length)}`);
  if (o.page && o.page in PAGE_TITLES) parts.push(`страница «${PAGE_TITLES[o.page]}»`);
  return parts.length ? parts.join(" · ") : null;
}
