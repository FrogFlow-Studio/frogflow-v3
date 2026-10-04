/**
 * Меню админки продавца: группы и пункты по модулям, роли и нише. Чистая
 * функция — страница только рисует результат, а тест проверяет состав.
 * Разделы выключенных модулей не рисуются совсем (не «серые»).
 */
import type { AdminKey } from "@/app/i18n/admin";
import type { ModuleKey } from "@/core/modules/registry";

export type NavItem = {
  /** Путь маршрута. */
  to: string;
  /** Ключ подписи в словаре админки (`nav.*`, `warehouse.nav` …). */
  label: AdminKey;
  /** Якорь внутри страницы (раздел «Розыгрыши» живёт в «Рассылках»). */
  hash?: string;
  /** Число рядом с подписью (непрочитанное, ждёт проверки). */
  badge?: { value: number; tone: "accent" | "warn" | "danger" };
  /** Подсвечивать только на точном совпадении пути. */
  exact?: boolean;
};

export type NavGroup = { id: string; label: AdminKey; items: NavItem[] };

export type NavShop = {
  role: string;
  vertical: string;
  modules: Partial<Record<ModuleKey, boolean>>;
  pricelist?: unknown;
  chatUnread?: number | null;
  ticketsOpen: number;
  /** Непрочитанные новости платформы — бейдж «Что нового». */
  newsUnread?: number;
  /** Непрочитанные ответы поддержки — бейдж «Поддержка». */
  supportUnread?: number;
  homeworkWaiting: number;
  undelivered: number;
};

export type AdminNav = {
  overview: NavItem;
  groups: NavGroup[];
  /** Четыре главных пункта нижней панели телефона (остальное — за «Ещё»). */
  primary: NavItem[];
};

const PHYSICAL = new Set(["confectionery", "flowers"]);

function compact<T>(xs: (T | false | null | undefined)[]): T[] {
  return xs.filter((x): x is T => Boolean(x));
}

export function buildAdminNav(shop: NavShop): AdminNav {
  const m = shop.modules;
  const owner = shop.role === "owner";
  const school = shop.vertical === "courses";
  const physical = PHYSICAL.has(shop.vertical);
  const overview: NavItem = { to: "/admin", label: "nav.overview", exact: true };
  const orders: NavItem = { to: "/admin/orders", label: "nav.orders" };

  if (shop.role === "accountant") {
    // Бухгалтеру — обзор, заказы, аналитика, прибыль, журнал склада и оплата тарифа.
    const groups: NavGroup[] = [
      {
        id: "sales",
        label: "nav.groupSales",
        items: [orders, { to: "/admin/notifications", label: "bell.nav" }],
      },
      {
        id: "analytics",
        label: "nav.groupAnalytics",
        items: compact<NavItem>([
          m.dashboard && { to: "/admin/analytics", label: "nav.analytics" },
          m.profit && { to: "/admin/cost", label: "cost.nav" },
          m.warehouse && { to: "/admin/warehouse/journal", label: "journal.nav" },
        ]),
      },
      {
        id: "settings",
        label: "nav.groupSettings",
        items: [{ to: "/admin/billing", label: "billing.nav" }],
      },
    ];
    return { overview, groups, primary: [overview, orders, ...groups[1]!.items].slice(0, 4) };
  }

  const homework: NavItem = {
    to: "/admin/homework",
    label: "homework.nav",
    badge: shop.homeworkWaiting > 0 ? { value: shop.homeworkWaiting, tone: "warn" } : undefined,
  };
  const chat: NavItem = {
    to: "/admin/chat",
    label: "nav.chat",
    badge: (shop.chatUnread ?? 0) > 0 ? { value: shop.chatUnread!, tone: "accent" } : undefined,
  };
  const products: NavItem = {
    to: "/admin/products",
    label: school ? "nav.courses" : "nav.products",
  };
  const customers: NavItem = { to: "/admin/customers", label: "nav.customers" };

  const sales: NavGroup = {
    id: "sales",
    label: "nav.groupSales",
    items: compact<NavItem>([
      orders,
      { to: "/admin/notifications", label: "bell.nav" },
      customers,
      m.manager_chat && chat,
      m.helpdesk &&
        m.manager_chat && {
          to: "/admin/tickets",
          label: "nav.tickets",
          badge: shop.ticketsOpen > 0 ? { value: shop.ticketsOpen, tone: "accent" } : undefined,
        },
      m.crm_pipeline && { to: "/admin/pipeline", label: "nav.pipeline" },
      m.review_request && { to: "/admin/reviews", label: "nav.reviews" },
      shop.undelivered > 0 && {
        to: "/admin/undelivered",
        label: "nav.undelivered",
        badge: { value: shop.undelivered, tone: "danger" },
      },
    ]),
  };

  const learning: NavGroup = {
    id: "learning",
    label: "nav.groupLearning",
    items: compact<NavItem>([
      m.courses && { to: "/admin/students", label: "nav.students" },
      m.courses && homework,
    ]),
  };

  const catalog: NavGroup = {
    id: "catalog",
    label: "nav.groupCatalog",
    items: compact<NavItem>([
      products,
      { to: "/admin/categories", label: "nav.categories" },
      m.web_storefront && { to: "/admin/collections", label: "collections.nav" },
      m.warehouse && { to: "/admin/warehouse", label: "warehouse.nav" },
      Boolean(shop.pricelist) && { to: "/admin/pricelist", label: "pricelist.nav" },
    ]),
  };

  const marketing: NavGroup = {
    id: "marketing",
    label: "nav.groupMarketing",
    items: compact<NavItem>([
      (m.broadcasts || m.wa_broadcasts || m.winback || m.funnel) && {
        to: "/admin/broadcasts",
        label: "nav.broadcasts",
      },
      (m.coupons || m.gift_certificates || m.referral || m.limited_offers) && {
        to: "/admin/discounts",
        label: "nav.discounts",
      },
      m.giveaways && { to: "/admin/broadcasts", label: "nav.giveaways", hash: "giveaways" },
      m.instagram && { to: "/admin/instagram", label: "nav.instagram" },
      m.instagram && { to: "/admin/posts", label: "nav.posts" },
      m.vip && { to: "/admin/vip", label: "nav.vip" },
      m.quiz && { to: "/admin/quiz", label: "nav.quiz" },
      { to: "/admin/consultant", label: "nav.consultant" },
    ]),
  };

  const analytics: NavGroup = {
    id: "analytics",
    label: "nav.groupAnalytics",
    items: compact<NavItem>([
      m.dashboard && { to: "/admin/analytics", label: "nav.analytics" },
      m.profit && { to: "/admin/cost", label: "cost.nav" },
    ]),
  };

  const settings: NavGroup = {
    id: "settings",
    label: "nav.groupSettings",
    items: compact<NavItem>([
      owner && {
        to: "/admin/settings",
        label: physical ? "nav.settingsPhysical" : "nav.settings",
      },
      owner && { to: "/admin/modules", label: "nav.modules" },
      { to: "/admin/billing", label: "billing.nav" },
      { to: "/admin/ai-balance", label: "nav.aiBalance" },
      { to: "/admin/bot-preview", label: "nav.botPreview" },
      owner && { to: "/admin/bot-texts", label: "botTexts.nav" },
      { to: "/admin/community", label: "nav.community" },
      owner && { to: "/admin/log", label: "audit.nav" },
      {
        to: "/admin/support",
        label: "support.nav",
        badge:
          (shop.supportUnread ?? 0) > 0
            ? { value: shop.supportUnread!, tone: "accent" }
            : undefined,
      },
      { to: "/admin/help", label: "help.nav" },
      {
        to: "/admin/news",
        label: "news.nav",
        badge: (shop.newsUnread ?? 0) > 0 ? { value: shop.newsUnread!, tone: "accent" } : undefined,
      },
    ]),
  };

  const groups = (school ? [sales, learning, catalog] : [sales, catalog, learning])
    .concat([marketing, analytics, settings])
    .filter((g) => g.items.length > 0);
  const fourth = m.manager_chat ? chat : customers;
  return { overview, groups, primary: [overview, orders, products, fourth] };
}
