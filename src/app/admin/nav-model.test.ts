import { describe, expect, it } from "vitest";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { buildAdminNav, type NavShop } from "./nav-model";

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
      "/admin/consultant",
      "/admin/pricelist",
      "/admin/chat",
    ]);
    // Без прайса и чата — покупатели.
    const bare = buildAdminNav(shop({ vertical: "consultant", sells: false })).primary;
    expect(bare.map((i) => i.to)).toEqual(["/admin", "/admin/consultant", "/admin/customers"]);
    // Комиссия с продаж — не ему; группы меню на месте.
    expect(labels(bovi)).not.toContain("/admin/commission");
    expect(labels(bovi)).toContain("/admin/orders");
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
    for (const l of SUPPORTED_LOCALES)
      for (const k of keys) expect(adminT(l)(k as AdminKey), `${l}:${k}`).not.toBe(k);
    // не откат на русский там, где слово другое
    expect(adminT("en")("nav.groupSales")).toBe("Sales");
    expect(adminT("kk")("nav.groupSales")).not.toBe(adminT("ru")("nav.groupSales"));
  });
});
