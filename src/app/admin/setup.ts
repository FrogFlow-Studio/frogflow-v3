/**
 * Мастер первого запуска на «Обзоре»: шаги по порядку и тестовый заказ на
 * себя. Чистые функции — страница рисует, тесты проверяют.
 */
export const SETUP_STEPS = [
  "telegram",
  "products",
  "payment",
  "notifications",
  "legal",
  "firstOrder",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Самый ранний несделанный шаг — его мастер подсвечивает; всё сделано — null. */
export function nextSetupStep(done: Record<SetupStep, boolean>): SetupStep | null {
  return SETUP_STEPS.find((s) => !done[s]) ?? null;
}

/**
 * Ссылка «Тестовый заказ на себя»: бот продавца сразу на карточке его
 * товара (тот же `/start p_<id>`, что у ссылок на товар). Продавец проходит
 * путь покупателя целиком: корзина, оформление, чек, подтверждение, выдача.
 * Нет бота или включённого товара — что именно сделать сначала.
 */
export function testOrderLink(
  botUsername: string | null,
  productId: string | null,
): { url: string } | { missing: "telegram" | "products" } {
  const bot = botUsername?.replace(/^@/, "") ?? "";
  if (!/^[A-Za-z0-9_]{3,64}$/.test(bot)) return { missing: "telegram" };
  if (!productId) return { missing: "products" };
  return { url: `https://t.me/${bot}?start=p_${productId}` };
}

/**
 * Карточка «Вы переехали на новую платформу» — один раз, продавцу, которого
 * оператор перевёл с v1: клиент на v2, дата переезда известна, в магазине
 * есть заказы старше неё (новый магазин, открытый сразу на v2, её не видит),
 * и продавец её ещё не закрыл.
 */
export function showMovedWelcome(p: {
  servedBy: "v1" | "v2" | undefined;
  since: string | undefined;
  hidden: boolean;
  ordersBeforeMove: number;
}): boolean {
  return p.servedBy === "v2" && Boolean(p.since) && !p.hidden && p.ordersBeforeMove > 0;
}

/**
 * Разделы прежней админки → где они теперь (подписи в i18n
 * «overview.moved.from.<from>», куда — подпись пункта меню `nav`). `modules` —
 * строка только у магазина, где включён хотя бы один из них.
 */
export const MOVED_MAP = [
  { from: "orders", to: "/admin/orders", nav: "nav.orders" },
  { from: "catalog", to: "/admin/products", nav: "nav.products" },
  { from: "payment", to: "/admin/settings", nav: "nav.settings" },
  {
    from: "promo",
    to: "/admin/discounts",
    nav: "nav.discounts",
    modules: ["coupons", "gift_certificates"],
  },
  {
    from: "broadcast",
    to: "/admin/broadcasts",
    nav: "nav.broadcasts",
    modules: ["broadcasts", "wa_broadcasts"],
  },
  { from: "chat", to: "/admin/chat", nav: "nav.chat", modules: ["manager_chat"] },
  { from: "blocked", to: "/admin/customers", nav: "nav.customers", modules: ["blocked"] },
  { from: "instagram", to: "/admin/instagram", nav: "nav.instagram", modules: ["instagram"] },
  { from: "whatsapp", to: "/admin/settings", nav: "nav.settings", modules: ["whatsapp"] },
  { from: "vip", to: "/admin/vip", nav: "nav.vip", modules: ["vip"] },
  { from: "settings", to: "/admin/settings", nav: "nav.settings" },
] as const;
export type MovedFrom = (typeof MOVED_MAP)[number]["from"];

/** Строки «что где теперь» для модулей этого магазина. */
export function movedRows(modules: Record<string, boolean | undefined>) {
  return MOVED_MAP.filter((r) => !("modules" in r) || r.modules.some((m) => modules[m]));
}
