import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { resolveWebFulfillment, webFulfillmentOptions } from "./web-fulfillment";
import { addDaysToIso, todayInTz } from "@/core/fulfillment/pure";
import { isoWeekday } from "@/core/fulfillment/closed-days";

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
        freeFrom: null,
      },
    ]);
  });

  it("порог бесплатной доставки: у зоны свой, иначе общий, в валюте платы за зону", async () => {
    const general = await webFulfillmentOptions(
      setup({ zones: true, settings: { delivery_free_from: "3000" } }),
      "KZ",
    );
    expect(general.zones[0]!.freeFrom).toEqual({ amount: 3000, currency: "KZT" });
    const own = await webFulfillmentOptions(
      setup({
        zones: true,
        settings: {
          delivery_free_from: "3000",
          delivery_free_zones: JSON.stringify({ "11111111-1111-4111-8111-111111111111": 1500 }),
        },
      }),
      "KZ",
    );
    expect(own.zones[0]!.freeFrom).toEqual({ amount: 1500, currency: "KZT" });
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

describe("нерабочие дни на сайте", () => {
  const closed = { fulfillment_closed_weekdays: "6,7", fulfillment_closed_dates: "2099-12-31" };

  it("форма получает нерабочие дни недели и отрезки", async () => {
    const o = await webFulfillmentOptions(setup({ settings: closed }), "KZ");
    expect(o.closedWeekdays).toEqual([6, 7]);
    expect(o.closedRanges).toEqual([{ from: "2099-12-31", to: "2099-12-31" }]);
    const empty = await webFulfillmentOptions(setup(), "KZ");
    expect(empty.closedWeekdays).toEqual([]);
    expect(empty.closedRanges).toEqual([]);
  });

  it("введённая вручную дата выходного и праздника отклонена с ближайшей рабочей", async () => {
    // Среда: не выходной и не понедельник после субботы (sat + 2), иначе по средам «ближайшая
    // рабочая» после субботы совпадала бы с праздником и тест краснел раз в неделю.
    const holiday = addDaysToIso(nextWeekday(3), 7);
    const ctx = setup({
      settings: { fulfillment_closed_weekdays: "6,7", fulfillment_closed_dates: holiday },
    });
    const sat = nextWeekday(6);
    expect(await resolveWebFulfillment(ctx, customer, { type: "pickup", date: sat }, "KZ")).toEqual(
      { ok: false, reason: "date_closed", nextDate: addDaysToIso(sat, 2) },
    );
    const r = await resolveWebFulfillment(ctx, customer, { type: "pickup", date: holiday }, "KZ");
    expect(r).toMatchObject({ ok: false, reason: "date_closed" });
    const next = (r as { nextDate: string }).nextDate;
    expect(next > holiday).toBe(true);
    expect(
      (await resolveWebFulfillment(ctx, customer, { type: "pickup", date: next }, "KZ")).ok,
    ).toBe(true);
  });

  it("срок изготовления идёт по рабочим дням", async () => {
    const ctx = setup({ settings: { fulfillment_closed_weekdays: "6,7" }, leadDays: 1 });
    const r = await resolveWebFulfillment(ctx, customer, { type: "pickup", date: today }, "KZ");
    expect(r).toMatchObject({ ok: false, reason: "date_early" });
    const min = (r as { minDate: string }).minDate;
    expect([6, 7]).not.toContain(isoWeekday(min));
    const ok = await resolveWebFulfillment(ctx, customer, { type: "pickup", date: min }, "KZ");
    expect(ok.ok).toBe(true);
  });
});

/** Ближайший день недели ISO (6 — суббота) не раньше чем через 10 дней: дальше срока изготовления. */
function nextWeekday(weekday: number): string {
  let d = addDaysToIso(today, 10);
  while (isoWeekday(d) !== weekday) d = addDaysToIso(d, 1);
  return d;
}

describe("лимит заказов на сайте", () => {
  const day = addDaysToIso(today, 10);
  const busyOrders = (ctx: ReturnType<typeof setup>, at: string, n = 1) => {
    const db = ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> };
    db.tables.orders = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      fulfillment_kind: "physical",
      fulfillment_at: at,
      status: "accepted",
    }));
  };

  it("форма получает занятые даты и занятые слоты", async () => {
    const ctx = setup({
      settings: {
        fulfillment_day_limit: "1",
        fulfillment_slot_limit: "1",
        fulfillment_slots: "10:00–12:00\n12:00–14:00",
      },
    });
    busyOrders(ctx, `${day}T10:00:00Z`);
    const o = await webFulfillmentOptions(ctx, "KZ");
    expect(o.fullDays).toEqual([day]);
    const ctx2 = setup({
      settings: {
        fulfillment_day_limit: "5",
        fulfillment_slot_limit: "1",
        fulfillment_slots: "10:00–12:00\n12:00–14:00",
      },
    });
    busyOrders(ctx2, `${day}T10:00:00Z`);
    const o2 = await webFulfillmentOptions(ctx2, "KZ");
    expect(o2.fullDays).toEqual([]);
    expect(o2.fullSlots).toEqual({ [day]: ["10:00–12:00"] });
  });

  it("занятая дата введена вручную — отказ с ближайшей свободной, соседняя проходит", async () => {
    const ctx = setup({ settings: { fulfillment_day_limit: "1" } });
    busyOrders(ctx, `${day}T00:00:00Z`);
    expect(await resolveWebFulfillment(ctx, customer, { type: "pickup", date: day }, "KZ")).toEqual(
      {
        ok: false,
        reason: "date_full",
        nextDate: addDaysToIso(day, 1),
      },
    );
    expect(
      (
        await resolveWebFulfillment(
          ctx,
          customer,
          { type: "pickup", date: addDaysToIso(day, 1) },
          "KZ",
        )
      ).ok,
    ).toBe(true);
  });

  it("занятый слот — отказ, свободный проходит", async () => {
    const ctx = setup({
      settings: { fulfillment_slot_limit: "1", fulfillment_slots: "10:00–12:00\n12:00–14:00" },
    });
    busyOrders(ctx, `${day}T10:00:00Z`);
    expect(
      await resolveWebFulfillment(
        ctx,
        customer,
        { type: "pickup", date: day, slot: "10:00–12:00" },
        "KZ",
      ),
    ).toEqual({ ok: false, reason: "slot_full" });
    expect(
      (
        await resolveWebFulfillment(
          ctx,
          customer,
          { type: "pickup", date: day, slot: "12:00–14:00" },
          "KZ",
        )
      ).ok,
    ).toBe(true);
  });
});
