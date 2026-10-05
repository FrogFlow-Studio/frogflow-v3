import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, themeForHash, themeShows, visibleThemes } from "./nav";
import { entryVisible, SETTINGS_REGISTRY } from "./registry";

describe("темы настроек в новом виде", () => {
  it("открывается «Магазин», а прежний вид по умолчанию показывает «Все»", () => {
    expect(DEFAULT_THEME).toBe("shop");
  });

  it("якорь #id открывает тему своей карточки — для каждой карточки реестра", () => {
    for (const e of SETTINGS_REGISTRY.filter((x) => !x.to))
      expect(themeForHash(`#${e.id}`), e.id).toBe(e.theme);
    expect(themeForHash("#zones")).toBe("payment");
    expect(themeForHash("#telegram")).toBe("channels");
  });

  it("неизвестный якорь, пустой адрес и раздел-ссылка тему не меняют", () => {
    expect(themeForHash("")).toBeNull();
    expect(themeForHash("#")).toBeNull();
    expect(themeForHash("#нет-такого")).toBeNull();
    expect(themeForHash("#consultant")).toBeNull();
  });

  it("показан раздел своей темы или любой при «Все» и при поиске", () => {
    expect(themeShows("shop", "shop", false)).toBe(true);
    expect(themeShows("shop", "payment", false)).toBe(false);
    expect(themeShows("all", "payment", false)).toBe(true);
    expect(themeShows("shop", "payment", true)).toBe(true);
  });

  it("тема «Деньги»: владельцу есть, менеджеру нет; пустая тема в списке не показывается", () => {
    const modules = { admin_roles: true };
    expect(visibleThemes({ role: "owner", modules })).toContain("money");
    expect(visibleThemes({ role: "manager", modules })).not.toContain("money");
    const money = SETTINGS_REGISTRY.filter((e) => e.theme === "money");
    expect(money.map((e) => e.id).sort()).toEqual(
      ["ai-balance", "billing", "commission", "payment-methods"].sort(),
    );
    for (const e of money) {
      expect(entryVisible(e, { role: "manager", modules }), e.id).toBe(false);
      expect(entryVisible(e, { role: "owner", modules }), e.id).toBe(true);
    }
    // страницы на месте: ссылки ведут туда, где они жили
    expect(money.filter((e) => e.to).map((e) => e.to)).toEqual([
      "/admin/commission",
      "/admin/billing",
      "/admin/ai-balance",
    ]);
  });
});

describe("«Удалить магазин» — в самом низу темы «Расширенное»", () => {
  it("последняя запись темы в реестре и последняя карточка на странице; не поднимается как «недавняя»", () => {
    const advanced = SETTINGS_REGISTRY.filter((e) => e.theme === "advanced");
    expect(advanced.at(-1)?.id).toBe("delete");
    expect(advanced.find((e) => e.id === "delete")?.keys).toBeUndefined();
    const page = readFileSync("src/routes/admin._authed.settings.tsx", "utf8");
    const onPage = [...page.matchAll(/<SettingsSection id="([^"]+)"/g)].map((m) => m[1]);
    expect(onPage.at(-1)).toBe("delete");
    // и подтверждение прежнее: та же карточка с вводом названия магазина
    expect(page).toContain("<DeleteShopCard locale={shop.locale} shopName={shop.name} />");
  });
});
