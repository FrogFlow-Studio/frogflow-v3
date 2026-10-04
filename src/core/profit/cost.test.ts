import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  listCostRows,
  listCosts,
  loadCost,
  parseAmountInput,
  parseCost,
  saveCost,
  unitCost,
} from "./cost";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const P = "11111111-1111-4111-8111-111111111111";

function shop(currency = "KZT") {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: currency }];
  db.tables.products = [
    {
      id: P,
      bot_id: BOT,
      name: "Торт",
      price: 9000,
      currency: "KZT",
      is_active: true,
      sort_order: 0,
    },
    {
      id: "p2",
      bot_id: BOT,
      name: "Свеча",
      price: 500,
      currency: "KZT",
      is_active: true,
      sort_order: 1,
    },
  ];
  db.tables.product_variants = [
    { id: "v1", bot_id: BOT, product_id: P, name: "1 кг", price: 9000, sort_order: 0 },
    { id: "v2", bot_id: BOT, product_id: P, name: "2 кг", price: 17000, sort_order: 1 },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { profit: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}
const row = (db: ReturnType<typeof shop>["db"], id = P) =>
  db.tables.app_settings!.find((r) => r.key === `cost:${id}`);

describe("себестоимость: чтение записи", () => {
  it("пусто — не задана, а не 0; 0 — осознанная себестоимость", () => {
    expect(parseCost(null)).toBeNull();
    expect(parseCost("")).toBeNull();
    expect(parseCost("{}")).toBeNull();
    expect(parseCost("мусор")).toBeNull();
    expect(parseCost('{"p":0,"cur":"KZT"}')).toEqual({ price: 0, variants: {}, currency: "KZT" });
  });

  it("отрицательные и нечисловые суммы отбрасываются", () => {
    expect(parseCost('{"p":-5,"v":{"1 кг":"x","2 кг":120},"cur":"kzt"}')).toEqual({
      price: null,
      variants: { "2 кг": 120 },
      currency: "KZT",
    });
  });

  it("у варианта своя себестоимость, без неё — товара, без обеих — не задана", () => {
    const c = parseCost('{"p":100,"v":{"2 кг":250},"cur":"KZT"}');
    expect(unitCost(c, "2 кг")).toBe(250);
    expect(unitCost(c, "1 кг")).toBe(100);
    expect(unitCost(c, null)).toBe(100);
    expect(unitCost(parseCost('{"v":{"2 кг":250},"cur":"KZT"}'), "1 кг")).toBeNull();
    expect(unitCost(null, null)).toBeNull();
  });

  it("поле формы: пусто, запятая, мусор", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput(" 1 200,5 ")).toBe(1200.5);
    expect(parseAmountInput("0")).toBe(0);
    expect(parseAmountInput("-1")).toBe("invalid");
    expect(parseAmountInput("12abc")).toBe("invalid");
    expect(parseAmountInput("1,234")).toBe("invalid");
  });
});

describe("себестоимость: запись", () => {
  it("сохраняет товар и вариант и читает обратно", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P, { price: 4000, variants: { "2 кг": 7500 } });
    expect(await loadCost(ctx, P)).toEqual({
      price: 4000,
      variants: { "2 кг": 7500 },
      currency: "KZT",
    });
  });

  it("стереть: null убирает поле, пустая запись — «не задана»", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P, { price: 4000 });
    expect(await saveCost(ctx, P, { price: null })).toBeNull();
    expect(row(db)?.value).toBe("");
    expect(await loadCost(ctx, P)).toBeNull();
  });

  it("гонка двух вкладок: правки разных полей обе сохраняются", async () => {
    const { ctx } = shop();
    await Promise.all([
      saveCost(ctx, P, { price: 4000 }),
      saveCost(ctx, P, { variants: { "1 кг": 3000 } }),
      saveCost(ctx, P, { variants: { "2 кг": 7500 } }),
    ]);
    expect(await loadCost(ctx, P)).toEqual({
      price: 4000,
      variants: { "1 кг": 3000, "2 кг": 7500 },
      currency: "KZT",
    });
  });

  it("чужой товар и несуществующий вариант отвергаются, запись не появляется", async () => {
    const { ctx, db } = shop();
    await expect(saveCost(ctx, "нет-такого", { price: 1 })).rejects.toMatchObject({
      key: "err.cost.noProduct",
    });
    await expect(saveCost(ctx, P, { variants: { "5 кг": 1 } })).rejects.toMatchObject({
      key: "err.cost.noVariant",
    });
    expect(row(db)).toBeUndefined();
  });

  it("отрицательная сумма отвергается", async () => {
    const { ctx, db } = shop();
    await expect(saveCost(ctx, P, { price: -1 })).rejects.toMatchObject({
      key: "err.cost.badAmount",
    });
    expect(row(db)).toBeUndefined();
  });

  it("вариант переименовали — его старая себестоимость не висит", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P, { price: 100, variants: { "2 кг": 7500 } });
    db.tables.product_variants![1]!.name = "2,5 кг";
    await saveCost(ctx, P, { price: 120 });
    expect(await loadCost(ctx, P)).toEqual({ price: 120, variants: {}, currency: "KZT" });
  });

  it("сменили валюту магазина — прежние суммы не переносятся под новый знак", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P, { price: 4000, variants: { "1 кг": 3000 } });
    db.tables.app_settings!.find((r) => r.key === "shop_currency")!.value = "RUB";
    await saveCost(ctx, P, { variants: { "2 кг": 900 } });
    expect(await loadCost(ctx, P)).toEqual({
      price: null,
      variants: { "2 кг": 900 },
      currency: "RUB",
    });
  });

  it("сбой чтения базы — ошибка, а не «себестоимости нет»", async () => {
    const { ctx, db } = shop();
    const from = db.from.bind(db);
    db.from = (t: string) => {
      if (t === "app_settings") throw new Error("база недоступна");
      return from(t);
    };
    await expect(loadCost(ctx, P)).rejects.toThrow();
  });
});

describe("себестоимость: список для страницы", () => {
  it("постранично и по ключу: больше тысячи записей не теряются", async () => {
    const { ctx, db } = shop();
    db.maxRows = 1000;
    for (let i = 0; i < 1500; i++)
      db.tables.app_settings!.push({
        bot_id: BOT,
        key: `cost:p${String(i).padStart(4, "0")}`,
        value: '{"p":1,"cur":"KZT"}',
      });
    expect((await listCosts(ctx)).size).toBe(1500);
  });

  it("товары с вариантами и себестоимостью; другая валюта — как не заданная", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P, { price: 4000, variants: { "2 кг": 7500 } });
    const ok = await listCostRows(ctx);
    expect(ok.currency).toBe("KZT");
    expect(ok.rows.map((r) => [r.name, r.cost?.price ?? null])).toEqual([
      ["Торт", 4000],
      ["Свеча", null],
    ]);
    expect(ok.rows[0]!.variants.map((v) => v.name)).toEqual(["1 кг", "2 кг"]);
    expect(ok.staleCurrency).toBe(0);
  });
});
