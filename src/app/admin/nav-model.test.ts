import { describe, expect, it } from "vitest";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { buildAdminNav, consultantWorkspace, WORKSPACE_PAGES, type NavShop } from "./nav-model";

const shop = (over: Partial<NavShop> = {}): NavShop => ({
  role: "owner",
  vertical: "confectionery",
  modules: {},
  ticketsOpen: 0,
  homeworkWaiting: 0,
  undelivered: 0,
  ...over,
});
const labels = (s: NavShop) =>
  buildAdminNav(s).groups.flatMap((g) =>
    g.items.map((i) => `${i.to}${i.hash ? `#${i.hash}` : ""}`),
  );

describe("меню админки", () => {
  it("модуль выключен — пункта нет, включён — есть", () => {
    expect(labels(shop())).not.toContain("/admin/warehouse");
    expect(labels(shop())).not.toContain("/admin/broadcasts#giveaways");
    const on = labels(shop({ modules: { warehouse: true, giveaways: true } }));
    expect(on).toContain("/admin/warehouse");
    expect(on).toContain("/admin/broadcasts#giveaways");
  });

  it("группы: продажи, каталог, маркетинг, аналитика, настройки; пустые не рисуются", () => {
    const n = buildAdminNav(shop({ modules: { dashboard: true } }));
    expect(n.groups.map((g) => g.id)).toEqual([
      "sales",
      "catalog",
      "marketing",
      "analytics",
      "settings",
    ]);
    const bare = buildAdminNav(shop({ role: "manager" }));
    expect(bare.groups.map((g) => g.id)).not.toContain("analytics");
  });

  it("нижняя панель — ровно четыре главных пункта", () => {
    expect(buildAdminNav(shop()).primary).toHaveLength(4);
    const chat = buildAdminNav(shop({ modules: { manager_chat: true } })).primary;
    expect(chat.map((i) => i.to)).toContain("/admin/chat");
  });

  it("консультант без продаж (BOVI): внизу консультант и прайс, не заказы и товары", () => {
    const bovi = shop({
      vertical: "consultant",
      modules: { shop: true, dm_shop: true, manager_chat: true },
      pricelist: {},
      sells: false,
    });
    expect(buildAdminNav(bovi).primary.map((i) => i.to)).toEqual([
      "/admin",
      "/admin/tasks",
      "/admin/chat",
      "/admin/pricelist",
    ]);
    // Без прайса и чата — покупатели.
    const bare = buildAdminNav(shop({ vertical: "consultant", sells: false })).primary;
    expect(bare.map((i) => i.to)).toEqual(["/admin", "/admin/consultant", "/admin/customers"]);
    // Комиссия с продаж — не ему.
    expect(labels(bovi)).not.toContain("/admin/commission");
    // Продаёт или не сказано — как раньше.
    for (const sells of [true, undefined]) {
      const n = buildAdminNav(shop({ vertical: "consultant", sells }));
      expect(n.primary.map((i) => i.to).slice(0, 3)).toEqual([
        "/admin",
        "/admin/orders",
        "/admin/products",
      ]);
      expect(labels(shop({ vertical: "consultant", sells }))).toContain("/admin/commission");
    }
  });

  it("консультант без продаж (BOVI): в меню нет разделов про продажу, его разделы на месте", () => {
    const all = {
      shop: true,
      dm_shop: true,
      manager_chat: true,
      web_storefront: true,
      warehouse: true,
      dashboard: true,
      profit: true,
      coupons: true,
      review_request: true,
      broadcasts: true,
      crm_pipeline: true,
      giveaways: true,
    } as const;
    const bovi = labels(
      shop({ vertical: "consultant", modules: all, pricelist: {}, sells: false }),
    );
    for (const gone of [
      "/admin/orders",
      "/admin/products",
      "/admin/categories",
      "/admin/collections",
      "/admin/warehouse",
      "/admin/analytics",
      "/admin/reports",
      "/admin/cost",
      "/admin/share",
      "/admin/discounts",
      "/admin/reviews",
      "/admin/commission",
      // Лента уведомлений знает только заказы и чеки — у консультанта она пуста.
      "/admin/notifications",
    ])
      expect(bovi, gone).not.toContain(gone);
    for (const kept of [
      "/admin/customers",
      "/admin/chat",
      "/admin/pipeline",
      "/admin/pricelist",
      "/admin/broadcasts",
      "/admin/broadcasts#giveaways",
      "/admin/consultant",
      "/admin/knowledge",
      "/admin/tasks",
      "/admin/settings",
      "/admin/modules",
      "/admin/billing",
    ])
      expect(bovi, kept).toContain(kept);
    // Пустые «Аналитика» и «Каталог» не рисуются; страницы консультанта — своей группой.
    const n = buildAdminNav(
      shop({ vertical: "consultant", modules: all, pricelist: {}, sells: false }),
    );
    expect(n.groups.map((g) => g.id)).not.toContain("analytics");
    expect(n.groups.map((g) => g.id)).not.toContain("catalog");
    // В боковом меню шесть страниц рабочего места закреплены сверху, по порядку.
    expect(n.pinned).toEqual([...WORKSPACE_PAGES]);
    // Каждая страница в меню один раз.
    expect(bovi.length).toBe(new Set(bovi).size);
    expect(buildAdminNav(shop({ vertical: "consultant" })).pinned).toBeUndefined();
    const settingsLabel = (s: NavShop) =>
      buildAdminNav(s)
        .groups.flatMap((g) => g.items)
        .find((i) => i.to === "/admin/settings")?.label;
    expect(settingsLabel(shop({ vertical: "consultant", sells: false }))).toBe("nav.groupSettings");
    expect(settingsLabel(shop({ vertical: "consultant" }))).toBe("nav.settings");
    // Тот же набор модулей у продающего — всё на месте.
    for (const sells of [true, undefined]) {
      const selling = labels(shop({ vertical: "consultant", modules: all, sells }));
      for (const x of ["/admin/orders", "/admin/products", "/admin/analytics", "/admin/share"])
        expect(selling, x).toContain(x);
    }
  });

  it("рабочее место консультанта: только у не продающего с прайсом", () => {
    expect(consultantWorkspace({ sells: false, pricelist: {} })).toBe(true);
    expect(consultantWorkspace({ sells: false })).toBe(false);
    expect(consultantWorkspace({ sells: true, pricelist: {} })).toBe(false);
    expect(consultantWorkspace({ pricelist: {} })).toBe(false);
  });

  it("рабочее место консультанта: бейдж задач, роли, без чата нет «Диалогов»", () => {
    const ws = (over: Partial<NavShop>) =>
      buildAdminNav(
        shop({ vertical: "consultant", pricelist: {}, sells: false, modules: {}, ...over }),
      );
    const owner = ws({ consultantTasksOpen: 3, modules: { manager_chat: true }, chatUnread: 2 });
    const items = owner.groups.flatMap((g) => g.items);
    expect(owner.groups[0]?.id).toBe("consultant");
    expect(items.find((i) => i.to === "/admin/tasks")?.badge).toEqual({ value: 3, tone: "warn" });
    expect(items.find((i) => i.to === "/admin/chat")?.label).toBe("ws.nav.dialogs");
    expect(items.find((i) => i.to === "/admin/chat")?.badge?.value).toBe(2);
    expect(ws({ consultantTasksOpen: 0 }).groups[0]?.items[0]?.badge).toBeUndefined();
    expect(ws({ consultantTasksOpen: null }).groups[0]?.items[0]?.badge).toBeUndefined();
    // Без модуля чата — без «Диалогов»; просмотрщику задачи не видны.
    expect(ws({}).pinned).toEqual([
      "/admin/tasks",
      "/admin/pricelist",
      "/admin/knowledge",
      "/admin/consultant",
    ]);
    expect(ws({ role: "viewer" }).pinned).not.toContain("/admin/tasks");
    expect(ws({ role: "manager" }).pinned).toContain("/admin/tasks");
  });

  it("продающий магазин: меню как раньше, без страниц рабочего места", () => {
    for (const over of [
      { vertical: "confectionery", pricelist: {} },
      { vertical: "consultant", pricelist: {}, sells: true },
      { vertical: "consultant", pricelist: {} },
    ] as Partial<NavShop>[]) {
      const n = buildAdminNav(shop({ modules: { manager_chat: true }, ...over }));
      const l = n.groups.flatMap((g) => g.items.map((i) => i.to));
      expect(l).not.toContain("/admin/tasks");
      expect(l).not.toContain("/admin/knowledge");
      expect(n.groups.map((g) => g.id)).not.toContain("consultant");
      expect(n.pinned).toBeUndefined();
      expect(n.primary.map((i) => i.to)).toEqual([
        "/admin",
        "/admin/orders",
        "/admin/products",
        "/admin/chat",
      ]);
    }
  });

  it("бухгалтер видит только заказы, аналитику и оплату", () => {
    const l = labels(
      shop({ role: "accountant", modules: { dashboard: true, profit: true, broadcasts: true } }),
    );
    expect(l).toEqual([
      "/admin/orders",
      "/admin/notifications",
      "/admin/analytics",
      "/admin/reports",
      "/admin/cost",
      "/admin/billing",
    ]);
  });

  it("не владелец не видит настройки, модули, журнал, оплату тарифа и баланс ИИ", () => {
    for (const role of ["manager", "viewer"] as const) {
      const l = labels(shop({ role }));
      for (const p of [
        "/admin/settings",
        "/admin/modules",
        "/admin/log",
        "/admin/billing",
        "/admin/ai-balance",
      ])
        expect(l).not.toContain(p);
    }
    expect(labels(shop({ role: "owner" }))).toContain("/admin/billing");
  });

  it("школа: курсы и ученики идут вперёд каталога", () => {
    const n = buildAdminNav(shop({ vertical: "courses", modules: { courses: true } }));
    expect(n.groups.map((g) => g.id).slice(0, 3)).toEqual(["sales", "learning", "catalog"]);
  });

  it("бейджи: домашние задания, чат, недоставленное", () => {
    const all = buildAdminNav(
      shop({
        modules: { courses: true, manager_chat: true },
        homeworkWaiting: 2,
        chatUnread: 3,
        undelivered: 1,
      }),
    ).groups.flatMap((g) => g.items);
    expect(all.find((i) => i.to === "/admin/homework")?.badge?.value).toBe(2);
    expect(all.find((i) => i.to === "/admin/chat")?.badge?.value).toBe(3);
    expect(all.find((i) => i.to === "/admin/undelivered")?.badge?.tone).toBe("danger");
  });

  it("все подписи меню переведены на 4 языка", () => {
    const n = buildAdminNav(
      shop({
        modules: {
          warehouse: true,
          giveaways: true,
          manager_chat: true,
          helpdesk: true,
          crm_pipeline: true,
          review_request: true,
          courses: true,
          dashboard: true,
          profit: true,
          instagram: true,
          vip: true,
          quiz: true,
          broadcasts: true,
          coupons: true,
        },
        undelivered: 1,
        pricelist: {},
      }),
    );
    const keys: AdminKey[] = [n.overview, ...n.groups.flatMap((g) => g.items)].map((i) => i.label);
    keys.push(
      ...n.groups.map((g) => g.label),
      "nav.more",
      "nav.moreTitle",
      "nav.close",
      "nav.bottomBar",
    );
    const ws = buildAdminNav(
      shop({
        vertical: "consultant",
        pricelist: {},
        sells: false,
        modules: { manager_chat: true },
      }),
    );
    keys.push(...ws.groups.flatMap((g) => [g.label, ...g.items.map((i) => i.label)]));
    for (const l of SUPPORTED_LOCALES)
      for (const k of keys) expect(adminT(l)(k as AdminKey), `${l}:${k}`).not.toBe(k);
    // не откат на русский там, где слово другое
    expect(adminT("en")("nav.groupSales")).toBe("Sales");
    expect(adminT("kk")("nav.groupSales")).not.toBe(adminT("ru")("nav.groupSales"));
  });
});
