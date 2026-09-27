import { describe, expect, it } from "vitest";
import type { Tenant } from "./types";

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

describe("VIP-клиент с двумя ботами при переезде", () => {
  // Основной магазин и VIP-бот — две записи bots одного продавца. Переезжают
  // по одному; связь ставит оператор (planLink), переключатель served_by её не трогает.
  const main = (servedBy: "v1" | "v2", group: string | null) =>
    shop(
      "main",
      { settings: { served_by: servedBy, ...(group ? { multi_bot: { group } } : {}) } } as never,
      null,
    );
  const vipShop = (servedBy: "v1" | "v2", group: string | null) =>
    shop(
      "vip",
      { settings: { served_by: servedBy, ...(group ? { multi_bot: { group } } : {}) } } as never,
      null,
    );

  it("оператор связывает, пока второй ещё на v1; второй появляется у продавца только после своего переезда", () => {
    const link = planLink(
      main("v2", null),
      vipShop("v1", null),
      "4a8f0c1e-0000-4000-8000-000000000001",
    );
    expect("changes" in link && link.changes.map((c) => c.botId)).toEqual(["main", "vip"]);
    const g = "4a8f0c1e-0000-4000-8000-000000000001";
    // Второй ещё на v1: в его админку v2 не пускает (правило 6).
    expect(groupShops([main("v2", g), vipShop("v1", g)], main("v2", g)).map((t) => t.id)).toEqual([
      "main",
    ]);
    // Переехал — оба магазина под одним входом.
    expect(groupShops([main("v2", g), vipShop("v2", g)], main("v2", g)).map((t) => t.id)).toEqual([
      "main",
      "vip",
    ]);
    // Откат второго на v1 снова прячет его, связь остаётся на повторный переезд.
    const back = vipShop("v1", g);
    expect(groupShops([main("v2", g), back], main("v2", g)).map((t) => t.id)).toEqual(["main"]);
    expect(shopGroup(back)).toBe(g);
  });

  it("связать можно и после переезда обоих", () => {
    const link = planLink(
      main("v2", null),
      vipShop("v2", null),
      "4a8f0c1e-0000-4000-8000-000000000002",
    );
    expect("changes" in link).toBe(true);
  });
});
