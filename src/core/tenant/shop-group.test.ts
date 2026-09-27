import { describe, expect, it, vi } from "vitest";
import type { Tenant } from "./types";

// Модуль в реестре пока «planned»; для проверки логики группы считаем его готовым.
vi.mock("@/core/modules/registry", async (orig) => {
  const real = await orig<typeof import("@/core/modules/registry")>();
  return {
    ...real,
    availableModules: (m: Record<string, boolean>) => ({
      ...real.availableModules(m),
      multi_bot: m.multi_bot === true,
    }),
  };
});

const { canSwitchShop, groupShops, shopGroup } = await import("./shop-group");
const { settingsFromJson } = await import("./directory");

const shop = (id: string, over: Partial<Tenant> = {}, group: string | null = "g1"): Tenant =>
  ({
    id,
    name: `Магазин ${id}`,
    status: "active",
    archived: false,
    modules: { multi_bot: true },
    settings: { served_by: "v2", ...(group ? { multi_bot: { group } } : {}) },
    ...over,
  }) as unknown as Tenant;

describe("несколько ботов: группа магазинов одного продавца", () => {
  it("группа читается из settings.multi_bot.group, пустая — нет группы", () => {
    expect(settingsFromJson({ multi_bot: { group: " Razvivashka " } }).multi_bot).toEqual({
      group: "razvivashka",
    });
    expect(settingsFromJson({ multi_bot: { group: "" } }).multi_bot).toBeUndefined();
    expect(settingsFromJson({}).multi_bot).toBeUndefined();
    expect(shopGroup(shop("a", {}, null))).toBeNull();
  });

  it("из своего магазина можно в магазин той же группы", () => {
    expect(canSwitchShop(shop("a"), shop("b"))).toBe(true);
    expect(canSwitchShop(shop("a"), shop("a", {}, null))).toBe(true);
  });

  it("в чужой, архивный, v1 или без модуля — нельзя", () => {
    const home = shop("a");
    expect(canSwitchShop(home, shop("b", {}, "g2"))).toBe(false);
    expect(canSwitchShop(home, shop("b", {}, null))).toBe(false);
    expect(canSwitchShop(shop("a", {}, null), shop("b", {}, null))).toBe(false);
    expect(canSwitchShop(home, shop("b", { archived: true }))).toBe(false);
    expect(
      canSwitchShop(home, shop("b", { settings: { served_by: "v1", multi_bot: { group: "g1" } } })),
    ).toBe(false);
    expect(canSwitchShop(home, shop("b", { modules: { multi_bot: false } as never }))).toBe(false);
    expect(canSwitchShop(shop("a", { modules: { multi_bot: false } as never }), shop("b"))).toBe(
      false,
    );
  });

  it("список магазинов: свой первым, дальше доступные по названию", () => {
    const home = shop("c");
    const dir = [shop("b"), home, shop("x", {}, "g2"), shop("a"), shop("d", { archived: true })];
    expect(groupShops(dir, home).map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(groupShops([shop("z", {}, null)], shop("z", {}, null)).map((t) => t.id)).toEqual(["z"]);
  });
});
