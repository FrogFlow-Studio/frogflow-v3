import { availableModules, type ModuleKey } from "@/core/modules/registry";
import { servedByV2 } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";

/**
 * Какие части /s/<slug> открыты при каких модулях. Страницы каталога общие
 * у веб-витрины и Mini App (Mini App открывает тот же адрес внутри Telegram),
 * поэтому каталог открыт при любом из двух платных модулей; корзина с сайта —
 * только у веб-витрины, «Мои заказы» и оформление из Mini App — только у Mini
 * App, юридические страницы — модуль legal_docs (базовый, включён всем).
 * «info» — шапка магазина: нужна и каталогу, и юр. страницам (ссылки из бота).
 * «course» — страница купленного курса (модуль courses): ссылка приходит при
 * выдаче в любой канал, поэтому платная витрина для неё не нужна.
 * «order» — страница заказа по подписанной ссылке: её получает покупатель из
 * Direct, WhatsApp или с сайта при любом магазине, поэтому и шапка («info»)
 * для неё открыта без витрины и юр. страниц — иначе выдача вела бы на 404.
 */
export type StorefrontPart =
  "info" | "catalog" | "web_handoff" | "web_checkout" | "mini_app" | "legal" | "course" | "order";

export function storefrontAllows(
  modules: Partial<Record<ModuleKey, boolean>>,
  part: StorefrontPart,
): boolean {
  if (!modules.shop) return false;
  switch (part) {
    case "info":
      return (
        storefrontAllows(modules, "catalog") ||
        storefrontAllows(modules, "legal") ||
        storefrontAllows(modules, "course") ||
        storefrontAllows(modules, "order")
      );
    case "order":
      return true;
    case "course":
      return Boolean(modules.courses);
    case "catalog":
      return Boolean(modules.web_storefront || modules.telegram_mini_app);
    case "web_handoff":
    case "web_checkout":
      return Boolean(modules.web_storefront);
    case "mini_app":
      return Boolean(modules.telegram_mini_app);
    case "legal":
      return Boolean(modules.legal_docs);
  }
}

/**
 * Открыта ли эта часть витрины клиента. Нет клиента, он в архиве, ещё на v1
 * или без оплаченного модуля — для покупателя это одно и то же: «магазин не
 * найден» (404), а не ошибка сервера.
 */
export function storefrontOpen(
  t:
    | (Pick<Tenant, "archived" | "settings"> & { modules: Partial<Record<ModuleKey, boolean>> })
    | null,
  part: StorefrontPart,
): boolean {
  // Модуль «в разработке» не открывает витрину, даже если флаг стоит в базе.
  return Boolean(
    t && !t.archived && servedByV2(t) && storefrontAllows(availableModules(t.modules), part),
  );
}
