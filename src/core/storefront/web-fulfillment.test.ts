import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { resolveWebFulfillment, webFulfillmentOptions } from "./web-fulfillment";
import { addDaysToIso, todayInTz } from "@/core/fulfillment/pure";

const TZ = "Asia/Almaty";
const customer = { userKey: "web_x", telegramId: -5, platform: "web", state: {} } as Customer;

function setup(
  opts: { settings?: Record<string, string>; zones?: boolean; leadDays?: number } = {},
) {
  const db = fakeDb();
  const bot = `00000000-0000-0000-0000-${String(Math.random()).slice(2, 14).padEnd(12, "0")}`;
  db.tables.app_settings = Object.entries(opts.settings ?? {}).map(([key, value]) => ({
    bot_id: bot,
    key,
    value,
  }));
  db.tables.delivery_zones = opts.zones
    ? [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Центр",
          price: 1000,
          is_active: true,
          sort_order: 0,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Старый",
          price: 500,
          is_active: false,
          sort_order: 1,
        },
      ]
    : [];
  db.tables.payment_methods = [
    { id: "pm", country_code: "KZ", currency: "KZT", is_active: true, sort_order: 0 },
  ];
  db.tables.cart_items = [
    { id: "c1", telegram_id: -5, products: { lead_time_days: opts.leadDays ?? 0 } },
  ];
  const ctx = {
    tenant: { id: bot, modules: {}, settings: {} },
    timezone: TZ,
    db,
  } as unknown as TenantContext;
  return ctx;
}

const today = todayInTz(TZ);

describe("получение физического заказа с сайта", () => {
  it("форма получает включённые способы, активные зоны с ценой и сегодняшнюю дату", async () => {
    const o = await webFulfillmentOptions(
      setup({ zones: true, settings: { fulfillment_pickup_enabled: "false" } }),
      "KZ",
    );
    expect(o).toMatchObject({ pickup: false, delivery: true, today });
    expect(o.zones).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Центр",
        fee: { amount: 1000, currency: "KZT" },
      },
    ]);
  });

  it("самовывоз на допустимую дату — как в боте, без адреса", async () => {
    const r = await resolveWebFulfillment(
      setup(),
      customer,
      { type: "pickup", date: today, address: "игнор", note: " к 5 вечера " },
      "KZ",
    );
    expect(r).toEqual({
      ok: true,
      input: { type: "pickup", at: today, address: null, note: "к 5 вечера", zone: null },
    });
  });

  it("без выбора или выключенным способом — нельзя", async () => {
    expect(await resolveWebFulfillment(setup(), customer, null, "KZ")).toEqual({
      ok: false,
      reason: "missing",
    });
    const ctx = setup({ settings: { fulfillment_delivery_enabled: "false" } });
    expect(
      await resolveWebFulfillment(
        ctx,
        customer,
        { type: "delivery", date: today, address: "a" },
        "KZ",
      ),
    ).toEqual({ ok: false, reason: "type" });
  });

  it("дата раньше срока изготовления товаров корзины — отказ с самой ранней датой", async () => {
    const r = await resolveWebFulfillment(
      setup({ leadDays: 3 }),
      customer,
      { type: "pickup", date: addDaysToIso(today, 2) },
      "KZ",
    );
    expect(r).toEqual({ ok: false, reason: "date_early", minDate: addDaysToIso(today, 3) });
  });

  it("несуществующая дата не проходит", async () => {
    expect(
      await resolveWebFulfillment(setup(), customer, { type: "pickup", date: "2026-02-30" }, "KZ"),
    ).toEqual({ ok: false, reason: "date" });
  });

  it("доставка: нужен адрес; при зонах — активная зона, её цена идёт в заказ", async () => {
    const ctx = setup({ zones: true });
    expect(
      await resolveWebFulfillment(
        ctx,
        customer,
        { type: "delivery", date: today, address: " " },
        "KZ",
      ),
    ).toEqual({ ok: false, reason: "address" });
    expect(
      await resolveWebFulfillment(
        ctx,
        customer,
        {
          type: "delivery",
          date: today,
          address: "Абая 1",
          zoneId: "22222222-2222-4222-8222-222222222222",
        },
        "KZ",
      ),
    ).toEqual({ ok: false, reason: "zone" });
    const ok = await resolveWebFulfillment(
      ctx,
      customer,
      {
        type: "delivery",
        date: today,
        address: "Абая 1",
        zoneId: "11111111-1111-4111-8111-111111111111",
      },
      "KZ",
    );
    expect(ok).toEqual({
      ok: true,
      input: {
        type: "delivery",
        at: today,
        address: "Абая 1",
        note: null,
        zone: { id: "11111111-1111-4111-8111-111111111111", name: "Центр", fee: 1000 },
      },
    });
  });
});
