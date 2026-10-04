import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import {
  COMMISSION_CURRENCY,
  COMMISSION_DEFAULT_START,
  COMMISSION_FREE_MONTHLY,
  COMMISSION_RATE_PERCENT,
  MONTHLY_PRICE,
} from "@/core/plans/registry";
import { monthlyCost, tierAdvice } from "./advice";
import { commissionableAmount, monthCommission, type CommissionOrder } from "./commission";

/**
 * Решения Якова по комиссии платформы (04.10.2026) одной таблицей. Числа
 * записаны буквами из решения, а не берутся из registry: если код разошёлся с
 * решением, падает именно этот файл, и ошибка — в коде, не в таблице.
 *
 * Решения: комиссия только с заказов витрины и площадки (platform = web);
 * Telegram-бот (в том числе Mini App), Instagram, WhatsApp и ручные — без неё;
 * ставки 10 / 5 / 1 % (Базовый / Про / Бизнес); первые 50 000 ₸ продаж в месяц
 * бесплатны; общий выключатель выключен по умолчанию; клиент v1, договорной
 * тариф и пустой месяц — без строки; суммы в целых тенге; тариф выгоднее
 * соседнего с 250 000 и 550 000 ₸ продаж в месяц.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));
// Контекст арендатора берёт ту же подставную базу и пояс Алматы.
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  tenantContext: (t: unknown) => ({
    tenant: t,
    db,
    appUrl: "https://t.test",
    timezone: "Asia/Almaty",
    secrets: {},
  }),
}));
const { commissionEnabled, setCommissionEnabled } = await import("./commission.server");
const { commissionBilling } = await import("./invoice.server");

describe("числа решения", () => {
  it("ставки, порог, валюта и цены тарифов", () => {
    expect(COMMISSION_RATE_PERCENT).toEqual({ basic: 10, pro: 5, business: 1 });
    expect(COMMISSION_FREE_MONTHLY).toBe(50_000);
    expect(COMMISSION_CURRENCY).toBe("KZT");
    expect(COMMISSION_DEFAULT_START).toBe("2027-01-01");
    expect(MONTHLY_PRICE).toEqual({ basic: 9_900, pro: 19_900, business: 39_900 });
  });
});

const order = (over: Partial<CommissionOrder> = {}): CommissionOrder => ({
  platform: "web",
  status: "paid",
  total: 100_000,
  paid_amount: 0,
  fulfillment_kind: "digital",
  currency: "KZT",
  day: "2027-02-10",
  ...over,
});

describe("какие заказы входят в базу", () => {
  const rows: Array<[string, Partial<CommissionOrder>, number]> = [
    ["витрина и площадка (web), оплачен", {}, 100_000],
    ["витрина, выдан", { status: "delivered" }, 100_000],
    ["бот Telegram", { platform: "telegram" }, 0],
    ["Mini App кладёт корзину в бота: заказ оформляет бот (telegram)", { platform: "telegram" }, 0],
    ["Instagram", { platform: "instagram" }, 0],
    ["WhatsApp", { platform: "whatsapp" }, 0],
    ["заведён вручную", { platform: "manual" }, 0],
    ["платформа не записана", { platform: null }, 0],
    ["ждёт оплаты", { status: "awaiting_payment" }, 0],
    ["отменён", { status: "cancelled" }, 0],
    ["не в тенге", { currency: "USD" }, 0],
    ["валюта не записана — считаем тенге", { currency: null }, 100_000],
  ];
  it.each(rows)("%s", (_name, over, expected) => {
    expect(commissionableAmount(order(over))).toBe(expected);
  });
  it("возврат уменьшает базу, не уходя ниже нуля", () => {
    expect(commissionableAmount(order(), 30_000)).toBe(70_000);
    expect(commissionableAmount(order(), 150_000)).toBe(0);
  });
});

describe("комиссия месяца: ставка, порог, выключатель, договорной тариф", () => {
  type Row = {
    name: string;
    plan: string | null;
    sales: number;
    enabled?: boolean;
    start?: string;
    month?: string;
    expect: { commission: number; accrues: boolean; reason: string | null; rate?: number | null };
  };
  const rows: Row[] = [
    {
      name: "Базовый 10 %: 150 000 → 100 000 сверх порога",
      plan: "flowers.basic",
      sales: 150_000,
      expect: { commission: 10_000, accrues: true, reason: null, rate: 10 },
    },
    {
      name: "Про 5 %",
      plan: "flowers.pro",
      sales: 150_000,
      expect: { commission: 5_000, accrues: true, reason: null, rate: 5 },
    },
    {
      name: "Бизнес 1 %",
      plan: "flowers.business",
      sales: 150_000,
      expect: { commission: 1_000, accrues: true, reason: null, rate: 1 },
    },
    {
      name: "ровно 50 000 — бесплатно",
      plan: "flowers.basic",
      sales: 50_000,
      expect: { commission: 0, accrues: true, reason: null },
    },
    {
      name: "50 001 — процент только с этой единицы",
      plan: "flowers.basic",
      sales: 50_100,
      expect: { commission: 10, accrues: true, reason: null },
    },
    {
      name: "пустой месяц",
      plan: "flowers.pro",
      sales: 0,
      expect: { commission: 0, accrues: true, reason: null },
    },
    {
      name: "выключатель выключен (по умолчанию) — ничего",
      plan: "flowers.basic",
      sales: 150_000,
      enabled: false,
      expect: { commission: 0, accrues: false, reason: "switch_off" },
    },
    {
      name: "договорной тариф — без ставки",
      plan: "custom",
      sales: 150_000,
      expect: { commission: 0, accrues: false, reason: "no_rate", rate: null },
    },
    {
      name: "клиент без плана — без ставки",
      plan: null,
      sales: 150_000,
      expect: { commission: 0, accrues: false, reason: "no_rate", rate: null },
    },
    {
      name: "месяц до даты начала у клиента",
      plan: "flowers.basic",
      sales: 150_000,
      start: "2027-03-01",
      expect: { commission: 0, accrues: false, reason: "before_start" },
    },
    {
      name: "месяц начала — считается с даты начала",
      plan: "flowers.basic",
      sales: 150_000,
      start: "2027-02-01",
      expect: { commission: 10_000, accrues: true, reason: null },
    },
    {
      name: "до общей даты 1 января: декабрь без комиссии",
      plan: "flowers.basic",
      sales: 150_000,
      month: "2026-12",
      expect: { commission: 0, accrues: false, reason: "before_start" },
    },
  ];
  it.each(rows)("$name", (r) => {
    const month = r.month ?? "2027-02";
    const out = monthCommission({
      month,
      orders: r.sales ? [order({ total: r.sales, day: `${month}-10` })] : [],
      plan: r.plan,
      enabled: r.enabled ?? true,
      start: r.start,
    });
    expect(out).toMatchObject({
      commission: r.expect.commission,
      accrues: r.expect.accrues,
      reason: r.expect.reason,
    });
    if (r.expect.rate !== undefined) expect(out.rate).toBe(r.expect.rate);
  });

  it("заказы разных каналов в одном месяце: в базу идёт только витрина", () => {
    const out = monthCommission({
      month: "2027-02",
      plan: "flowers.basic",
      enabled: true,
      orders: [
        order({ total: 100_000 }),
        order({ platform: "telegram", total: 900_000 }),
        order({ platform: "instagram", total: 900_000 }),
        order({ platform: "whatsapp", total: 900_000 }),
      ],
    });
    expect(out).toMatchObject({ sales: 100_000, orders: 1, commission: 5_000 });
  });
});

describe("точки выгоды смены тарифа", () => {
  it("250 000 ₸ продаж в месяц между Базовым и Про, 550 000 между Про и Бизнесом", () => {
    expect(monthlyCost("basic", 250_000)).toBe(29_900);
    expect(monthlyCost("pro", 250_000)).toBe(29_900);
    expect(tierAdvice("basic", 250_000)).toBeNull();
    expect(tierAdvice("basic", 250_001)).toMatchObject({ tier: "pro" });
    expect(monthlyCost("pro", 550_000)).toBe(44_900);
    expect(monthlyCost("business", 550_000)).toBe(44_900);
    expect(tierAdvice("pro", 550_000)).toBeNull();
    expect(tierAdvice("pro", 550_001)).toMatchObject({ tier: "business" });
  });
});

describe("в счёте за подписку: выключатель, клиент v1, договорной тариф, целые тенге", () => {
  const BOT = "00000000-0000-0000-0000-0000000000d3";
  const NOW = new Date("2027-03-05T10:00:00Z");
  const tenant = (plan: string | null, settings: Record<string, unknown>): Tenant =>
    ({
      id: BOT,
      name: "Магазин",
      plan,
      vertical: null,
      modules: {},
      settings: settingsFromJson(settings),
    }) as unknown as Tenant;
  const v2 = { served_by: "v2" };

  beforeEach(() => {
    db = fakeDb();
    db.tables.operator_settings = [];
    db.tables.subscription_invoices = [];
    db.tables.zernio_logs = [];
    db.tables.bots = [{ id: BOT, settings: {} }];
    db.tables.orders = [
      // 33 333 + 100 000 = 133 333 ₸ → 83 333 сверх порога; 10 % = 8 333,3 → 8 333 ₸.
      {
        id: 1,
        bot_id: BOT,
        platform: "web",
        status: "paid",
        total: 100_000,
        paid_amount: 0,
        fulfillment_kind: "digital",
        currency: "KZT",
        created_at: "2027-02-10T10:00:00Z",
      },
      {
        id: 2,
        bot_id: BOT,
        platform: "web",
        status: "paid",
        total: 33_333,
        paid_amount: 0,
        fulfillment_kind: "digital",
        currency: "KZT",
        created_at: "2027-02-11T10:00:00Z",
      },
      {
        id: 3,
        bot_id: BOT,
        platform: "telegram",
        status: "paid",
        total: 900_000,
        paid_amount: 0,
        fulfillment_kind: "digital",
        currency: "KZT",
        created_at: "2027-02-12T10:00:00Z",
      },
    ];
  });
  it("выключатель по умолчанию выключен: записи нет — строки нет", async () => {
    expect(await commissionEnabled()).toBe(false);
    expect(await commissionBilling(tenant("flowers.basic", v2), NOW)).toEqual({
      lines: [],
      months: [],
    });
  });

  it("включён: сумма в целых тенге, только заказ витрины", async () => {
    await setCommissionEnabled(true);
    const r = await commissionBilling(tenant("flowers.basic", v2), NOW);
    expect(r.months).toEqual(["2027-02"]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.amount).toBe(8_333);
    expect(Number.isInteger(r.lines[0]!.amount)).toBe(true);
    expect(r.lines[0]!.title).toContain("10 %");
    expect(r.lines[0]!.title).toContain("133 333");
  });

  it("клиент прежней платформы, договорной тариф и клиент без плана — строки нет", async () => {
    await setCommissionEnabled(true);
    const none = { lines: [], months: [] };
    expect(await commissionBilling(tenant("flowers.basic", {}), NOW)).toEqual(none);
    expect(await commissionBilling(tenant("custom", v2), NOW)).toEqual(none);
    expect(await commissionBilling(tenant(null, v2), NOW)).toEqual(none);
  });

  it("выключатель можно выключить обратно: строки пропадают", async () => {
    await setCommissionEnabled(true);
    await setCommissionEnabled(false);
    expect(await commissionBilling(tenant("flowers.basic", v2), NOW)).toEqual({
      lines: [],
      months: [],
    });
  });

  it("продажи до порога и пустой месяц — строки нет", async () => {
    await setCommissionEnabled(true);
    db.tables.orders = [];
    expect(await commissionBilling(tenant("flowers.pro", v2), NOW)).toEqual({
      lines: [],
      months: [],
    });
    db.tables.orders = [
      {
        id: 9,
        bot_id: BOT,
        platform: "web",
        status: "paid",
        total: 50_000,
        paid_amount: 0,
        fulfillment_kind: "digital",
        currency: "KZT",
        created_at: "2027-02-10T10:00:00Z",
      },
    ];
    expect(await commissionBilling(tenant("flowers.pro", v2), NOW)).toEqual({
      lines: [],
      months: [],
    });
  });
});
