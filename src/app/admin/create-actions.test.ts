import { describe, expect, it } from "vitest";
import { adminT } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { buildAdminNav, type NavShop } from "./nav-model";
import { createActions } from "./create-actions";

const shop = (over: Partial<NavShop> = {}): NavShop => ({
  role: "owner",
  vertical: "confectionery",
  modules: { manager_chat: true, broadcasts: true, coupons: true },
  ticketsOpen: 0,
  homeworkWaiting: 0,
  undelivered: 0,
  ...over,
});
const keys = (s: NavShop) => createActions(buildAdminNav(s), s).map((a) => a.key);

describe("«Создать»: что предлагается", () => {
  it("владелец: заказ, товар, рассылка, акция, ответ во «Входящих»", () => {
    expect(keys(shop())).toEqual(["order", "product", "broadcast", "promo", "reply"]);
  });

  it("менеджеру нет «новой акции», остальное есть", () => {
    expect(keys(shop({ role: "manager" }))).toEqual(["order", "product", "broadcast", "reply"]);
  });

  it("бухгалтеру и «только просмотр» — ничего", () => {
    expect(keys(shop({ role: "accountant" }))).toEqual([]);
    expect(keys(shop({ role: "viewer" }))).toEqual([]);
  });

  it("выключенный модуль — действия нет; «новый заказ» только у кондитерских и цветочных", () => {
    expect(keys(shop({ modules: {} }))).toEqual(["order", "product"]);
    expect(keys(shop({ vertical: "digital" }))).toEqual(["product", "broadcast", "promo", "reply"]);
  });

  for (const lang of SUPPORTED_LOCALES)
    it(`${lang}: подписи действий на месте`, () => {
      const t = adminT(lang);
      const s = shop();
      for (const a of createActions(buildAdminNav(s), s)) expect(t(a.label)).not.toBe(a.label);
      expect(t("create.button")).not.toBe("create.button");
      expect(t("create.title")).not.toBe("create.title");
    });
});
