/**
 * Меню админки продавца: группы и пункты по модулям, роли и нише. Чистая
 * функция — страница только рисует результат, а тест проверяет состав.
 * Разделы выключенных модулей не рисуются совсем (не «серые»).
 */
import type { AdminKey } from "@/app/i18n/admin";
import { roleAllows, type AdminRole } from "@/core/auth/roles";
import type { ModuleKey } from "@/core/modules/registry";
import { notificationsInNav } from "@/app/admin/notifications-visible";

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
  /**
   * Продаёт ли клиент (`sellsNow`). Консультант без продаж (BOVI) не начинает
   * с заказов и товаров: внизу — консультант и прайс, а в меню нет разделов
   * про продажу (заказы, товары, склад, аналитика продаж, скидки, отзывы о
   * покупках, «Поделиться магазином»). Страницы по прямой ссылке открываются.
   * Нет значения — продаёт.
   */
  sells?: boolean;
  chatUnread?: number | null;
  /**
   * Открытые задачи консультанта (передачи менеджеру) — бейдж «Задачи» в
   * рабочем месте консультанта. null/нет — не известно, бейджа нет.
   */
  consultantTasksOpen?: number | null;
  /**
   * Число моделей каталога, по которым покупатели просили фото/видео, а медиа нет.
   * Бейдж «Фото и видео» в рабочем месте консультанта.
   */
  consultantMediaDemands?: number | null;
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
  /**
   * Закреплённые под «Обзором» в боковом меню (в группах их тогда нет):
   * магазину — «Заказы» и «Входящие», консультанту без продаж — консультант,
   * прайс и «Входящие». Нет значения — как у магазина.
   */
  pinned?: string[];
};

const PHYSICAL = new Set(["confectionery", "flowers"]);

/**
 * Рабочее место консультанта: клиент не продаёт (`sells === false`) и
 * отвечает по прайсу (BOVI). Тогда меню — страницы сверху: «Обзор»,
 * «Задачи», «Диалоги», «Прайс», «Фото и видео», «База знаний», «Настройки бота».
 */
export function consultantWorkspace(shop: { sells?: boolean; pricelist?: unknown }): boolean {
  return shop.sells === false && Boolean(shop.pricelist);
}

/** Страницы рабочего места консультанта под «Обзором», по порядку. */
export const WORKSPACE_PAGES = [
  "/admin/tasks",
  "/admin/chat",
  "/admin/pricelist",
  "/admin/media",
  "/admin/knowledge",
  "/admin/consultant",
] as const;

function compact<T>(xs: (T | false | null | undefined)[]): T[] {
  return xs.filter((x): x is T => Boolean(x));
}

export function buildAdminNav(shop: NavShop): AdminNav {
  const m = shop.modules;
  const owner = shop.role === "owner";
  // Настройки, тексты бота и журнал — владельцу и администратору; тариф и платежи — только владельцу.
  const admin = roleAllows(shop.role as AdminRole, "admin");
  const school = shop.vertical === "courses";
  const physical = PHYSICAL.has(shop.vertical);
  const sells = shop.sells !== false;
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
          m.dashboard && { to: "/admin/reports", label: "reports.nav" },
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
  const consultant: NavItem = { to: "/admin/consultant", label: "nav.consultant" };
  const pricelist: NavItem = { to: "/admin/pricelist", label: "pricelist.nav" };

  const sales: NavGroup = {
    id: "sales",
    label: "nav.groupSales",
    items: compact<NavItem>([
      sells && orders,
      notificationsInNav(shop) && { to: "/admin/notifications", label: "bell.nav" },
      customers,
      m.manager_chat && chat,
      m.helpdesk &&
        m.manager_chat && {
          to: "/admin/tickets",
          label: "nav.tickets",
          badge: shop.ticketsOpen > 0 ? { value: shop.ticketsOpen, tone: "accent" } : undefined,
        },
      m.crm_pipeline && { to: "/admin/pipeline", label: "nav.pipeline" },
      sells && m.review_request && { to: "/admin/reviews", label: "nav.reviews" },
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
      sells && products,
      sells && { to: "/admin/categories", label: "nav.categories" },
      sells && m.web_storefront && { to: "/admin/collections", label: "collections.nav" },
      sells && m.warehouse && { to: "/admin/warehouse", label: "warehouse.nav" },
      Boolean(shop.pricelist) && pricelist,
    ]),
  };

  const marketing: NavGroup = {
    id: "marketing",
    label: "nav.groupMarketing",
    items: compact<NavItem>([
      sells && { to: "/admin/share", label: "share.nav" },
      (m.broadcasts || m.wa_broadcasts || m.winback || m.funnel) && {
        to: "/admin/broadcasts",
        label: "nav.broadcasts",
      },
      sells &&
        (m.coupons || m.gift_certificates || m.referral || m.limited_offers) && {
          to: "/admin/discounts",
          label: "nav.discounts",
        },
      m.giveaways && { to: "/admin/broadcasts", label: "nav.giveaways", hash: "giveaways" },
      m.instagram && { to: "/admin/instagram", label: "nav.instagram" },
      m.instagram && { to: "/admin/posts", label: "nav.posts" },
      m.vip && { to: "/admin/vip", label: "nav.vip" },
      m.quiz && { to: "/admin/quiz", label: "nav.quiz" },
      consultant,
    ]),
  };

  const analytics: NavGroup = {
    id: "analytics",
    label: "nav.groupAnalytics",
    items: compact<NavItem>([
      // Аналитика, отчёты и прибыль считают заказы и товары: без продаж там пусто.
      sells && m.dashboard && { to: "/admin/analytics", label: "nav.analytics" },
      sells && m.dashboard && { to: "/admin/reports", label: "reports.nav" },
      sells && m.profit && { to: "/admin/cost", label: "cost.nav" },
    ]),
  };

  const settings: NavGroup = {
    id: "settings",
    label: "nav.groupSettings",
    items: compact<NavItem>([
      admin && {
        to: "/admin/settings",
        // Без продаж в настройках нет оплаты — подпись не обещает её.
        label: physical ? "nav.settingsPhysical" : sells ? "nav.settings" : "nav.groupSettings",
      },
      owner && { to: "/admin/modules", label: "nav.modules" },
      owner && { to: "/admin/billing", label: "billing.nav" },
      owner && sells && { to: "/admin/commission", label: "commission.nav" },
      owner && { to: "/admin/ai-balance", label: "nav.aiBalance" },
      { to: "/admin/bot-preview", label: "nav.botPreview" },
      admin && { to: "/admin/bot-texts", label: "botTexts.nav" },
      { to: "/admin/community", label: "nav.community" },
      admin && { to: "/admin/log", label: "audit.nav" },
      {
        to: "/admin/support",
        label: "support.nav",
        badge:
          (shop.supportUnread ?? 0) > 0
            ? { value: shop.supportUnread!, tone: "accent" }
            : undefined,
      },
      {
        to: "/admin/news",
        label: "news.nav",
        badge: (shop.newsUnread ?? 0) > 0 ? { value: shop.newsUnread!, tone: "accent" } : undefined,
      },
    ]),
  };

  // «Помощь» — перед «Настройками»: быстрый старт, справочник по разделам, «что делать, если».
  const help: NavGroup = {
    id: "help",
    label: "help.nav",
    items: [
      { to: "/admin/help/start", label: "help.start" },
      { to: "/admin/help/guide", label: "help.guide" },
      { to: "/admin/help/trouble", label: "help.trouble" },
    ],
  };

  if (consultantWorkspace(shop)) {
    // Рабочее место консультанта: его страницы — своей группой, закреплённой сверху;
    // из «Продаж», «Каталога» и «Маркетинга» они уходят, чтобы не повторяться.
    const tasks: NavItem | null = roleAllows(shop.role as AdminRole, "manager")
      ? {
          to: "/admin/tasks",
          label: "ws.nav.tasks",
          badge:
            (shop.consultantTasksOpen ?? 0) > 0
              ? { value: shop.consultantTasksOpen!, tone: "warn" }
              : undefined,
        }
      : null;
    const dialogs: NavItem | null = m.manager_chat ? { ...chat, label: "ws.nav.dialogs" } : null;
    const price: NavItem = { to: "/admin/pricelist", label: "ws.nav.price" };
    const media: NavItem = {
      to: "/admin/media",
      label: "ws.nav.media",
      badge:
        (shop.consultantMediaDemands ?? 0) > 0
          ? { value: shop.consultantMediaDemands!, tone: "danger" }
          : undefined,
    };
    const knowledge: NavItem = { to: "/admin/knowledge", label: "ws.nav.knowledge" };
    const botSettings: NavItem = { to: "/admin/consultant", label: "ws.nav.botSettings" };
    const workspace: NavGroup = {
      id: "consultant",
      label: "ws.nav.group",
      items: compact<NavItem>([tasks, dialogs, price, media, knowledge, botSettings]),
    };
    const mine = new Set<string>(WORKSPACE_PAGES);
    const without = (g: NavGroup): NavGroup => ({
      ...g,
      items: g.items.filter((i) => i.hash || !mine.has(i.to)),
    });
    const groups = [
      workspace,
      ...[sales, catalog, learning, marketing, analytics, help, settings].map(without),
    ].filter((g) => g.items.length > 0);
    // «Фото и видео» — в меню; нижняя панель телефона прежняя, «База знаний» в ней остаётся.
    const primary = compact<NavItem>([overview, tasks, dialogs, price, knowledge]).slice(0, 4);
    return { overview, groups, primary, pinned: workspace.items.map((i) => i.to) };
  }

  const groups = (school ? [sales, learning, catalog] : [sales, catalog, learning])
    .concat([marketing, analytics, help, settings])
    .filter((g) => g.items.length > 0);
  const fourth = m.manager_chat ? chat : customers;
  if (!sells) {
    // Консультанту без продаж заказы и товары пусты: внизу — то, с чем он работает.
    const primary = compact<NavItem>([
      overview,
      consultant,
      Boolean(shop.pricelist) && pricelist,
      m.manager_chat && chat,
      customers,
    ]).slice(0, 4);
    const pinned = ["/admin/consultant", "/admin/pricelist", "/admin/chat"];
    return { overview, groups, primary, pinned };
  }
  return { overview, groups, primary: [overview, orders, products, fourth] };
}
