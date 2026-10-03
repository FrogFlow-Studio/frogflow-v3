import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { awardPointsForOrder } from "@/core/discounts/discounts";
import { customerTierStatus, parseTiers, tierStatus, validateTiers } from "./tiers";

const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;
const TIERS = [
  { name: "Серебро", from: 10000, percent: 7 },
  { name: "Золото", from: 50000, percent: 10 },
];

function setup(opts: { tiers?: unknown; delivered?: number[] } = {}) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.app_settings = [
    { bot_id: BOT, key: "shop_currency", value: "KZT" },
    { bot_id: BOT, key: "loyalty_earn_percent", value: "5" },
    ...(opts.tiers === undefined
      ? []
      : [{ bot_id: BOT, key: "loyalty_tiers", value: JSON.stringify(opts.tiers) }]),
  ];
  db.tables.orders = [
    ...(opts.delivered ?? []).map((total, i) => ({
      id: i + 1,
      telegram_id: TG,
      status: "delivered",
      total,
      currency: "KZT",
      points_earned: 0,
    })),
    {
      id: 100,
      telegram_id: TG,
      status: "delivered",
      total: 1000,
      currency: "KZT",
      points_earned: 0,
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { loyalty: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("уровни: разбор и границы", () => {
  it("уровень по сумме, граница включается, до следующего", () => {
    const tiers = parseTiers(JSON.stringify(TIERS));
    expect(tierStatus(tiers, 9999.99).tier).toBeNull();
    expect(tierStatus(tiers, 9999.99).next).toMatchObject({ remaining: 0.01 });
    expect(tierStatus(tiers, 10000).tier?.name).toBe("Серебро");
    expect(tierStatus(tiers, 49999).tier?.name).toBe("Серебро");
    expect(tierStatus(tiers, 50000).tier?.name).toBe("Золото");
    expect(tierStatus(tiers, 50000).next).toBeNull();
  });

  it("нечитаемое сохранённое значение — «уровней нет», ввод продавца проверяется", () => {
    expect(parseTiers("не json")).toEqual([]);
    expect(parseTiers("")).toEqual([]);
    expect(() => validateTiers(Array(5).fill(TIERS[0]))).toThrow();
    expect(() => validateTiers([{ name: "", from: 0, percent: 5 }])).toThrow();
    expect(() => validateTiers([{ name: "A", from: 0, percent: 101 }])).toThrow();
    expect(() =>
      validateTiers([
        { name: "A", from: 5, percent: 5 },
        { name: "B", from: 5, percent: 6 },
      ]),
    ).toThrow();
    expect(validateTiers([TIERS[1], TIERS[0]]).map((t) => t.name)).toEqual(["Серебро", "Золото"]);
  });
});

describe("начисление по уровню", () => {
  it("уровень по сумме ДО заказа: заказ, переводящий на уровень, начисляет по прежнему", async () => {
    // Выдано на 9500; заказ на 1000 переводит на «Серебро», но считается по общему 5 %.
    const { db, ctx } = setup({ tiers: TIERS, delivered: [9500] });
    expect(await awardPointsForOrder(ctx, 100, TG, 1000, "KZT")).toBe(50);
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(50);
    // Следующий заказ уже по уровню: сумма до него 10 500.
    db.tables.orders!.push({
      id: 101,
      telegram_id: TG,
      status: "delivered",
      total: 1000,
      currency: "KZT",
      points_earned: 0,
    });
    expect(await awardPointsForOrder(ctx, 101, TG, 1000, "KZT")).toBe(70);
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(120);
  });

  it("повторная выдача не начисляет дважды", async () => {
    const { db, ctx } = setup({ tiers: TIERS, delivered: [20000] });
    expect(await awardPointsForOrder(ctx, 100, TG, 1000, "KZT")).toBe(70);
    expect(await awardPointsForOrder(ctx, 100, TG, 1000, "KZT")).toBe(0);
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(70);
  });

  it("без уровней — прежний loyalty_earn_percent", async () => {
    const { db, ctx } = setup({ delivered: [90000] });
    expect(await awardPointsForOrder(ctx, 100, TG, 1000, "KZT")).toBe(50);
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(50);
  });

  it("заказы других покупателей и не выданные в сумму не входят", async () => {
    const { db, ctx } = setup({ tiers: TIERS });
    db.tables.orders!.push(
      { id: 5, telegram_id: 1, status: "delivered", total: 99999, currency: "KZT" },
      { id: 6, telegram_id: TG, status: "pending", total: 99999, currency: "KZT" },
    );
    expect(await awardPointsForOrder(ctx, 100, TG, 1000, "KZT")).toBe(50);
  });

  it("сбой чтения заказов — отказ, а не молчаливый общий процент", async () => {
    const { db, ctx } = setup({ tiers: TIERS });
    const broken: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => broken,
    });
    const bad = {
      ...ctx,
      db: new Proxy(db, {
        get: (t, prop, r) =>
          prop === "from"
            ? (n: string) => (n === "orders" ? broken : t.from(n))
            : Reflect.get(t, prop, r),
      }),
    } as unknown as TenantContext;
    await expect(awardPointsForOrder(bad, 100, TG, 1000, "KZT")).rejects.toThrow(/loyalty/);
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(0);
  });

  it("статус для бота: уровень и сколько до следующего", async () => {
    const { ctx } = setup({ tiers: TIERS, delivered: [12000] });
    const st = await customerTierStatus(ctx, TG, "KZT");
    expect(st?.tier?.name).toBe("Серебро");
    expect(st?.next?.remaining).toBe(50000 - 13000);
    expect(await customerTierStatus(setup().ctx, TG, "KZT")).toBeNull();
  });
});
