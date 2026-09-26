import { describe, expect, it } from "vitest";
import {
  addDaysToIso,
  amountDue,
  fulfillmentTotalBelowPaid,
  fulfillmentTypePatch,
  isoToDisplay,
  matchesPickupFilter,
  matchFulfillmentType,
  parseDateInput,
  remainingDueNow,
  todayInTz,
} from "./pure";

describe("fulfillment pure", () => {
  it("дата: разбор, отображение, сдвиг", () => {
    expect(parseDateInput("05.03.2026")).toBe("2026-03-05");
    expect(parseDateInput("5/3/2026")).toBe("2026-03-05");
    expect(parseDateInput("31.02.2026")).toBeNull();
    expect(parseDateInput("завтра")).toBeNull();
    expect(isoToDisplay("2026-03-05")).toBe("05.03.2026");
    expect(addDaysToIso("2026-02-27", 3)).toBe("2026-03-02");
    expect(todayInTz("Asia/Almaty", new Date("2026-03-05T20:30:00Z"))).toBe("2026-03-06");
  });

  it("задаток: полная, процент, при получении", () => {
    expect(amountDue(10000, "full", 30)).toBe(10000);
    expect(amountDue(10000, "deposit", 30)).toBe(3000);
    expect(amountDue(10000, "deposit", 0)).toBe(3000);
    expect(amountDue(10000, "on_receipt", 30)).toBe(0);
  });

  it("тип получения из текста", () => {
    expect(matchFulfillmentType("Самовывоз")).toBe("pickup");
    expect(matchFulfillmentType("нужна доставка")).toBe("delivery");
    expect(matchFulfillmentType("не знаю")).toBeNull();
  });
});

describe("remainingDueNow — задаток не двоится после «Внести оплату»", () => {
  it("без внесённого пишет весь задаток", () => {
    expect(remainingDueNow(3000, 0)).toBe(3000);
    expect(remainingDueNow(3000, null)).toBe(3000);
  });

  it("после ручной записи задатка больше ничего не дописывает", () => {
    expect(remainingDueNow(3000, 3000)).toBe(0);
  });

  it("дописывает только недостающую часть задатка", () => {
    expect(remainingDueNow(3000, 1000)).toBe(2000);
  });

  it("не пишет отрицательное, если внесено больше задатка", () => {
    expect(remainingDueNow(3000, 4000)).toBe(0);
  });

  it("on_receipt / нулевой due — ничего", () => {
    expect(remainingDueNow(0, 0)).toBe(0);
    expect(remainingDueNow(Number.NaN, 0)).toBe(0);
  });
});

describe("fulfillmentTypePatch — доставка ↔ самовывоз", () => {
  it("доставка → самовывоз снимает зону и комиссию с total", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "delivery", delivery_fee: 1500, total: 21500 },
        "pickup",
      ),
    ).toEqual({
      fulfillment_type: "pickup",
      delivery_zone_id: null,
      delivery_zone_name: null,
      delivery_fee: 0,
      total: 20000,
    });
  });

  it("повторное сохранение самовывоза не вычитает комиссию второй раз", () => {
    expect(
      fulfillmentTypePatch({ fulfillment_type: "pickup", delivery_fee: 0, total: 20000 }, "pickup"),
    ).toEqual({ fulfillment_type: "pickup" });
  });

  it("самовывоз → доставка не выдумывает комиссию без зоны", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "pickup", delivery_fee: 0, total: 20000 },
        "delivery",
      ),
    ).toEqual({ fulfillment_type: "delivery" });
  });

  it("самовывоз → доставка с зоной прибавляет комиссию к total", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "pickup", delivery_fee: 0, total: 20000 },
        "delivery",
        { id: "zone-1", name: "Центр", price: 1500 },
      ),
    ).toEqual({
      fulfillment_type: "delivery",
      delivery_zone_id: "zone-1",
      delivery_zone_name: "Центр",
      delivery_fee: 1500,
      total: 21500,
    });
  });

  it("смена зоны пересчитывает комиссию, не складывая её поверх старой", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "delivery", delivery_fee: 1500, total: 21500 },
        "delivery",
        { id: "zone-2", name: "Окраина", price: 2500 },
      ),
    ).toEqual({
      fulfillment_type: "delivery",
      delivery_zone_id: "zone-2",
      delivery_zone_name: "Окраина",
      delivery_fee: 2500,
      total: 22500,
    });
  });
});

describe("fulfillmentTotalBelowPaid", () => {
  const patch = fulfillmentTypePatch(
    { fulfillment_type: "delivery", delivery_fee: 1500, total: 21500 },
    "pickup",
  );

  it("оплачено больше нового total — блокирует смену", () => {
    expect(fulfillmentTotalBelowPaid(patch, 21500)).toBe(true);
    expect(fulfillmentTotalBelowPaid(patch, 20001)).toBe(true);
  });

  it("оплачено не больше нового total — разрешает смену", () => {
    expect(fulfillmentTotalBelowPaid(patch, 20000)).toBe(false);
    expect(fulfillmentTotalBelowPaid(patch, 0)).toBe(false);
  });

  it("patch без total (тип не менялся) — ничего не блокирует", () => {
    expect(fulfillmentTotalBelowPaid({}, 99999)).toBe(false);
  });
});

describe("matchesPickupFilter", () => {
  const today = "2026-09-02";
  const cake = {
    fulfillment_kind: "physical",
    fulfillment_at: "2026-09-02T00:00:00Z",
    status: "in_production",
  };

  it("сегодня/завтра не показывают уже выданные торты", () => {
    expect(matchesPickupFilter({ ...cake, status: "delivered" }, "today", today)).toBe(false);
    expect(matchesPickupFilter(cake, "today", today)).toBe(true);
    expect(
      matchesPickupFilter({ ...cake, fulfillment_at: "2026-09-03T00:00:00Z" }, "tomorrow", today),
    ).toBe(true);
  });

  it("без даты — только открытые физические без fulfillment_at", () => {
    expect(
      matchesPickupFilter({ ...cake, fulfillment_at: null, status: "accepted" }, "nodate", today),
    ).toBe(true);
    expect(matchesPickupFilter(cake, "nodate", today)).toBe(false);
    expect(
      matchesPickupFilter(
        { ...cake, fulfillment_kind: "digital", fulfillment_at: null },
        "nodate",
        today,
      ),
    ).toBe(false);
  });

  it("просрочено — дата в прошлом и заказ ещё открыт", () => {
    const past = { ...cake, fulfillment_at: "2026-09-01T00:00:00Z" };
    expect(matchesPickupFilter(past, "overdue", today)).toBe(true);
    expect(matchesPickupFilter({ ...past, status: "delivered" }, "overdue", today)).toBe(false);
    expect(matchesPickupFilter({ ...past, status: "rejected" }, "overdue", today)).toBe(false);
  });
});
