/**
 * Мастер первого запуска на «Обзоре»: шаги по порядку и тестовый заказ на
 * себя. Чистые функции — страница рисует, тесты проверяют.
 */
export const SETUP_STEPS = [
  "telegram",
  "products",
  "payment",
  "delivery",
  "notifications",
  "legal",
  "botTexts",
  "firstOrder",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Сколько товаров нужно для «магазин наполнен» (шаг «Товары»). */
export const PRODUCTS_TARGET = 5;

/**
 * Шаги про продажу: консультанту, который не продаёт (`sellsNow`), их нет.
 * Реквизиты (оферта) и строка-приветствие витрины — тоже про магазин: поле
 * приветствия у такого консультанта в настройках не показывается.
 */
const SALES_STEPS: readonly SetupStep[] = [
  "products",
  "payment",
  "delivery",
  "legal",
  "botTexts",
  "firstOrder",
];

/**
 * Какие шаги вообще относятся к магазину. Доставка нужна только физическому
 * магазину с включённой витриной заказов: у онлайн-школы и без модуля «shop»
 * строки «Доставка» в списке нет совсем. Консультант без продаж (BOVI: модуль
 * магазина из v1, товаров нет) товары, оплату, доставку, реквизиты,
 * приветствие витрины и первый заказ не настраивает. `sells` не передан — продаёт.
 */
export function relevantSetupSteps(shop: {
  modules: Partial<Record<string, boolean>>;
  vertical: string;
  sells?: boolean;
}): SetupStep[] {
  return SETUP_STEPS.filter(
    (s) =>
      (shop.sells !== false || !SALES_STEPS.includes(s)) &&
      (s !== "delivery" || (shop.modules.shop && shop.vertical !== "courses")),
  );
}

/** «Скрытые» шаги из настройки `setup_skipped` (список через запятую): мусор отбрасывается. */
export function parseSkippedSteps(raw: string | null | undefined): SetupStep[] {
  const set = new Set((raw ?? "").split(",").map((x) => x.trim()));
  return SETUP_STEPS.filter((s) => set.has(s));
}

/** Новая строка `setup_skipped` после «скрыть»/«вернуть» одного шага. */
export function toggleSkippedStep(
  raw: string | null | undefined,
  step: SetupStep,
  skip: boolean,
): string {
  const cur = new Set(parseSkippedSteps(raw));
  if (skip) cur.add(step);
  else cur.delete(step);
  return SETUP_STEPS.filter((s) => cur.has(s)).join(",");
}

export type SetupRow = { step: SetupStep; done: boolean; skipped: boolean };

/**
 * Прогресс запуска: считается по фактическим настройкам. Скрытый шаг в
 * знаменатель не входит; сделанный скрытый всё равно считается сделанным.
 * Нечего считать (всё скрыто) — 100%.
 */
export function setupProgress(
  done: Record<SetupStep, boolean>,
  relevant: readonly SetupStep[],
  skipped: readonly SetupStep[],
): { rows: SetupRow[]; doneCount: number; total: number; percent: number } {
  const rows = relevant.map((step) => ({
    step,
    done: done[step],
    skipped: skipped.includes(step) && !done[step],
  }));
  const counted = rows.filter((r) => !r.skipped);
  const doneCount = counted.filter((r) => r.done).length;
  const percent = counted.length === 0 ? 100 : Math.round((doneCount / counted.length) * 100);
  return { rows, doneCount, total: counted.length, percent };
}

/** Самый ранний несделанный и не скрытый шаг — его мастер подсвечивает; иначе null. */
export function nextSetupStep(
  done: Record<SetupStep, boolean>,
  relevant: readonly SetupStep[] = SETUP_STEPS,
  skipped: readonly SetupStep[] = [],
): SetupStep | null {
  return relevant.find((s) => !done[s] && !skipped.includes(s)) ?? null;
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

/** Строки про продажу: консультанту без продаж заказы, каталог и оплата не нужны. */
const MOVED_SALES: readonly MovedFrom[] = ["orders", "catalog", "payment"];

/** Строки «что где теперь» для модулей этого магазина; `sells: false` — без заказов, каталога и оплаты. */
export function movedRows(modules: Record<string, boolean | undefined>, sells = true) {
  return MOVED_MAP.filter(
    (r) =>
      (sells || !MOVED_SALES.includes(r.from)) &&
      (!("modules" in r) || r.modules.some((m) => modules[m])),
  );
}
