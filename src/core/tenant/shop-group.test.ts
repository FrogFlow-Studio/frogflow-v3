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

const { canSwitchShop, groupShops, planLink, planUnlink, shopGroup } = await import("./shop-group");
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

describe("оператор связывает и отвязывает магазины", () => {
  it("два свободных магазина — новая группа из переданного uuid", () => {
    const a = shop("a1", {}, null);
    const b = shop("b2", {}, null);
    expect(planLink(a, b, "NEW-G")).toEqual({
      changes: [
        { botId: "a1", group: "new-g" },
        { botId: "b2", group: "new-g" },
      ],
    });
  });

  it("свободный магазин входит в существующую группу, остальные не трогаем", () => {
    expect(planLink(shop("a", {}, "g1"), shop("b", {}, null), "n")).toEqual({
      changes: [{ botId: "b", group: "g1" }],
    });
    expect(planLink(shop("a", {}, null), shop("b", {}, "g1"), "n")).toEqual({
      changes: [{ botId: "a", group: "g1" }],
    });
    expect(planLink(shop("a"), shop("b"), "n")).toEqual({ changes: [] });
  });

  it("разные группы не сливаются, с собой не связывается", () => {
    expect(planLink(shop("a", {}, "g1"), shop("b", {}, "g2"), "n")).toHaveProperty("error");
    expect(planLink(shop("a"), shop("a"), "n")).toHaveProperty("error");
  });

  it("отвязка: из группы трёх уходит один, из группы двух — оба", () => {
    const dir = [shop("a"), shop("b"), shop("c"), shop("x", {}, "g2")];
    expect(planUnlink(dir, dir[0]!)).toEqual([{ botId: "a", group: null }]);
    const two = [shop("a"), shop("b"), shop("x", {}, "g2")];
    expect(planUnlink(two, two[0]!)).toEqual([
      { botId: "a", group: null },
      { botId: "b", group: null },
    ]);
    expect(planUnlink(two, shop("z", {}, null))).toEqual([]);
  });
});
