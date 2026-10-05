import { describe, expect, it } from "vitest";
import { adminT } from "@/app/i18n/admin";
import { themeForHash } from "./nav";
import { searchSettings } from "./palette";
import { entryMatches, SETTINGS_REGISTRY } from "./registry";

const t = adminT("ru");
const owner = { role: "owner", modules: { stripe: true, admin_roles: true } };

describe("поиск настроек: тема и карточка; Ctrl K открывает сразу на своей теме", () => {
  it("«часовой пояс» → карточка магазина, тема «Магазин»", () => {
    const [hit] = searchSettings(owner, "часовой пояс", t);
    expect(hit).toMatchObject({ hash: "shop", to: "/admin/settings", theme: "Магазин" });
    expect(themeForHash(`#${hit!.hash}`)).toBe("shop");
  });

  it("название темы находит её разделы: «Деньги» → способы оплаты", () => {
    const find = (q: string) =>
      SETTINGS_REGISTRY.filter((e) => entryMatches(e, q, (k, v) => t(k, v))).map((e) => e.id);
    expect(find("деньги")).toEqual(
      expect.arrayContaining(["payment-methods", "commission", "billing", "ai-balance"]),
    );
    expect(find("каналы")).toContain("telegram");
  });

  it("каждая найденная настройка ведёт на тему, где её карточка лежит", () => {
    for (const e of SETTINGS_REGISTRY.filter((x) => !x.to)) {
      const hit = searchSettings(owner, e.id, t).find((h) => h.hash === e.id);
      if (hit) expect(themeForHash(`#${hit.hash}`), e.id).toBe(e.theme);
    }
  });

  it("раздел с отдельной страницы ведёт туда; чужой роли настроек нет; пустой запрос пуст", () => {
    expect(
      searchSettings(owner, "консультант", t).find((h) => h.to === "/admin/consultant"),
    ).toBeTruthy();
    const manager = { role: "manager", modules: {} };
    expect(searchSettings(manager, "stripe_secret", t)).toEqual([]);
    expect(searchSettings(manager, "комиссия", t)).toEqual([]);
    expect(searchSettings(owner, "  ", t)).toEqual([]);
  });

  it("не больше пяти подсказок", () => {
    expect(searchSettings(owner, "а", t).length).toBeLessThanOrEqual(5);
  });
});
