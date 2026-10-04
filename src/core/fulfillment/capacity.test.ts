import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  dateAvailability,
  dayUnavailable,
  freeSlots,
  freeSlotsOnDate,
  loadByDay,
  loadSummary,
  nextFreeDay,
  parseLimit,
} from "./capacity";
import { parseClosedRules } from "./closed-days";

const SLOTS = "10:00–12:00\n12:00–14:00";

function setup(settings: Record<string, string>, orders: Array<[string, string, string?]> = []) {
  const db = fakeDb();
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: "b",
    key,
    value,
  }));
  db.tables.orders = orders.map(([at, status, kind], i) => ({
    id: i + 1,
    bot_id: "b",
    fulfillment_kind: kind ?? "physical",
    fulfillment_at: at,
    status,
  }));
  return { db, ctx: { tenant: { id: "b" }, db } as unknown as TenantContext };
}

const NONE = parseClosedRules("", "");

describe("загрузка выдачи", () => {
  it("лимит: положительное целое, остальное — без лимита", () => {
    expect(parseLimit("5")).toBe(5);
    expect(parseLimit(" 12 ")).toBe(12);
    for (const bad of ["", "0", "-1", "2.5", "abc", "10000", null, undefined])
      expect(parseLimit(bad as string | null | undefined)).toBeNull();
  });

  it("считаются живые и выданные физические заказы с датой; отклонённые, отменённые, возвращённые и цифровые — нет", async () => {
    const { ctx } = setup({}, [
      ["2026-10-12T10:00:00Z", "awaiting_payment"],
      ["2026-10-12T10:00:00Z", "delivered"],
      ["2026-10-12T00:00:00Z", "accepted"],
      ["2026-10-12T12:00:00Z", "rejected"],
      ["2026-10-12T12:00:00Z", "cancelled"],
      ["2026-10-12T12:00:00Z", "refunded"],
      ["2026-10-12T12:00:00Z", "accepted", "digital"],
      ["2026-10-13T10:00:00Z", "accepted"],
    ]);
    const m = await loadByDay(ctx, "2026-10-12", "2026-10-13");
    expect(m.get("2026-10-12")).toEqual({ total: 3, slots: { "10:00": 2 } });
    expect(m.get("2026-10-13")).toEqual({ total: 1, slots: { "10:00": 1 } });
  });

  it("читается постранично: больше тысячи заказов не обрезаются", async () => {
    const orders: Array<[string, string]> = Array.from({ length: 1205 }, () => [
      "2026-10-12T10:00:00Z",
      "accepted",
    ]);
    const { ctx } = setup({}, orders);
    expect((await loadByDay(ctx, "2026-10-12", "2026-10-12")).get("2026-10-12")!.total).toBe(1205);
  });

  it("день занят по лимиту на день или когда заняты все слоты", () => {
    const load = { total: 2, slots: { "10:00": 1, "12:00": 1 } };
    const slots = ["10:00–12:00", "12:00–14:00"];
    expect(dayUnavailable(load, slots, { day: 2, slot: null })).toBe(true);
    expect(dayUnavailable(load, slots, { day: 3, slot: 1 })).toBe(true);
    expect(dayUnavailable(load, slots, { day: 3, slot: 2 })).toBe(false);
    // Лимит на слот без слотов у магазина не действует.
    expect(dayUnavailable(load, [], { day: null, slot: 1 })).toBe(false);
    expect(freeSlots(slots, { total: 1, slots: { "10:00": 1 } }, { day: null, slot: 1 })).toEqual([
      "12:00–14:00",
    ]);
  });

  it("ближайший свободный день пропускает занятые и нерабочие", () => {
    const loads = new Map([
      ["2026-10-12", { total: 1, slots: {} }],
      ["2026-10-13", { total: 1, slots: {} }],
    ]);
    const rules = parseClosedRules("3", ""); // среда 2026-10-14 закрыта
    const next = nextFreeDay(
      "2026-10-12",
      loads,
      [],
      { day: 1, slot: null },
      (d) => d === "2026-10-14" && rules.weekdays.includes(3),
    );
    expect(next).toBe("2026-10-15");
  });

  it("доступность даты: без лимитов всегда да; занятый день — отказ с ближайшей свободной датой", async () => {
    const free = setup({}, [["2026-10-12T00:00:00Z", "accepted"]]);
    expect(await dateAvailability(free.ctx, "2026-10-12", NONE)).toEqual({ ok: true });
    const busy = setup({ fulfillment_day_limit: "1" }, [["2026-10-12T00:00:00Z", "accepted"]]);
    expect(await dateAvailability(busy.ctx, "2026-10-12", NONE)).toEqual({
      ok: false,
      nextDate: "2026-10-13",
    });
    expect(await dateAvailability(busy.ctx, "2026-10-13", NONE)).toEqual({ ok: true });
  });

  it("слоты даты: занятый не предлагается", async () => {
    const { ctx } = setup({ fulfillment_slot_limit: "1", fulfillment_slots: SLOTS }, [
      ["2026-10-12T10:00:00Z", "awaiting_payment"],
    ]);
    expect(await freeSlotsOnDate(ctx, "2026-10-12")).toEqual(["12:00–14:00"]);
    expect(await freeSlotsOnDate(ctx, "2026-10-13")).toEqual(["10:00–12:00", "12:00–14:00"]);
  });

  it("сводка для «К выдаче»: только при лимитах, сегодня и завтра по слотам", async () => {
    const none = setup({ fulfillment_slots: SLOTS });
    expect(await loadSummary(none.ctx, "2026-10-12")).toBeNull();
    const { ctx } = setup({ fulfillment_day_limit: "5", fulfillment_slots: SLOTS }, [
      ["2026-10-12T10:00:00Z", "accepted"],
      ["2026-10-13T12:00:00Z", "accepted"],
    ]);
    expect(await loadSummary(ctx, "2026-10-12")).toEqual({
      limits: { day: 5, slot: null },
      days: [
        {
          date: "2026-10-12",
          total: 1,
          slots: [
            { slot: "10:00–12:00", count: 1 },
            { slot: "12:00–14:00", count: 0 },
          ],
        },
        {
          date: "2026-10-13",
          total: 1,
          slots: [
            { slot: "10:00–12:00", count: 0 },
            { slot: "12:00–14:00", count: 1 },
          ],
        },
      ],
    });
  });
});
