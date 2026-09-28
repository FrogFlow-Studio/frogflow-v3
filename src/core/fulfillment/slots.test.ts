import { describe, expect, it } from "vitest";
import { fulfillmentAtValue, normalizeSlot, parseSlots, slotOf, withSlot } from "./slots";

describe("слоты получения", () => {
  it("запись слота прощает точку, дефис и одну цифру часа; пустой и перевёрнутый — не слот", () => {
    expect(normalizeSlot("9.00 - 12:00")).toBe("09:00–12:00");
    expect(normalizeSlot("18:00—20:30")).toBe("18:00–20:30");
    expect(normalizeSlot("12:00–10:00")).toBeNull();
    expect(normalizeSlot("утром")).toBeNull();
  });

  it("список из настройки: по строке или через запятую, без повторов, по порядку", () => {
    expect(parseSlots("14:00-16:00\n10:00–12:00, 10:00-12:00;мусор")).toEqual([
      "10:00–12:00",
      "14:00–16:00",
    ]);
    expect(parseSlots(null)).toEqual([]);
  });

  it("в заказ пишется начало слота из списка, чужое время — полночь", () => {
    const slots = ["10:00–12:00"];
    expect(fulfillmentAtValue(withSlot("2026-09-30", "10:00–12:00"), slots)).toBe(
      "2026-09-30T10:00:00Z",
    );
    expect(fulfillmentAtValue("2026-09-30T13:00", slots)).toBe("2026-09-30T00:00:00Z");
    expect(fulfillmentAtValue("2026-09-30", slots)).toBe("2026-09-30T00:00:00Z");
  });

  it("слот заказа восстанавливается по началу; только дата — без слота", () => {
    const slots = ["10:00–12:00"];
    expect(slotOf("2026-09-30T10:00:00+00:00", slots)).toBe("10:00–12:00");
    expect(slotOf("2026-09-30T15:00:00Z", slots)).toBe("с 15:00");
    expect(slotOf("2026-09-30T00:00:00Z", slots)).toBeNull();
    expect(slotOf(null, slots)).toBeNull();
  });
});
