/**
 * Нижние вкладки Mini App, как в v1 (tests/mini-app-*.test.ts): «Каталог»,
 * у магазина материалов — «Материалы» (купленные файлы), «Заказы» и
 * «Корзина». Вкладки есть только внутри Telegram: заказы и материалы видны
 * по подписанному initData, в браузере их нет.
 */
export type MiniAppTab = "catalog" | "library" | "orders" | "cart";

export function miniAppTabs(vertical: string): MiniAppTab[] {
  return vertical === "digital"
    ? ["catalog", "library", "orders", "cart"]
    : ["catalog", "orders", "cart"];
}

/** Какая вкладка подсвечена: по пути страницы и `?tab=` на странице заказов. */
export function activeTab(
  pathname: string,
  slug: string,
  tab: string | undefined,
): MiniAppTab | null {
  const rest = pathname.replace(/\/+$/, "").slice(`/s/${slug}`.length);
  if (rest === "" || rest.startsWith("/p/")) return "catalog";
  if (rest === "/cart") return "cart";
  if (rest === "/orders") return tab === "library" ? "library" : "orders";
  return null;
}

/** Что показывать на странице заказов: `library` — только материалы, `orders` — только заказы. */
export function ordersView(tab: unknown): "library" | "orders" | "all" {
  return tab === "library" || tab === "orders" ? tab : "all";
}
