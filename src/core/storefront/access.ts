import type { ModuleKey } from "@/core/modules/registry";

/**
 * Какие части /s/<slug> открыты при каких модулях. Страницы каталога общие
 * у веб-витрины и Mini App (Mini App открывает тот же адрес внутри Telegram),
 * поэтому каталог открыт при любом из двух платных модулей; корзина с сайта —
 * только у веб-витрины, «Мои заказы» и оформление из Mini App — только у Mini
 * App, юридические страницы — модуль legal_docs (базовый, включён всем).
 * «info» — шапка магазина: нужна и каталогу, и юр. страницам (ссылки из бота).
 */
export type StorefrontPart = "info" | "catalog" | "web_handoff" | "mini_app" | "legal";

export function storefrontAllows(
  modules: Partial<Record<ModuleKey, boolean>>,
  part: StorefrontPart,
): boolean {
  if (!modules.shop) return false;
  switch (part) {
    case "info":
      return storefrontAllows(modules, "catalog") || storefrontAllows(modules, "legal");
    case "catalog":
      return Boolean(modules.web_storefront || modules.telegram_mini_app);
    case "web_handoff":
      return Boolean(modules.web_storefront);
    case "mini_app":
      return Boolean(modules.telegram_mini_app);
    case "legal":
      return Boolean(modules.legal_docs);
  }
}
