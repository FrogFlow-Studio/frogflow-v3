import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES,
  isClosedStage,
  leadKey,
  orderStage,
  parseLead,
  sanitizeLeadInput,
} from "./stages";

describe("этапы воронки", () => {
  it("порядок колонок доски", () => {
    expect(PIPELINE_STAGES).toEqual([
      "new",
      "in_progress",
      "awaiting_payment",
      "paid",
      "won",
      "lost",
    ]);
  });

  it("этап заказа следует за его статусом", () => {
    expect(orderStage("awaiting_payment")).toBe("awaiting_payment");
    expect(orderStage("awaiting_confirmation")).toBe("awaiting_payment");
    for (const s of ["paid", "accepted", "in_production", "ready", "delivering"])
      expect(orderStage(s), s).toBe("paid");
    expect(orderStage("delivered")).toBe("won");
    expect(orderStage("rejected")).toBe("lost");
    expect(orderStage("cancelled")).toBe("lost");
    expect(orderStage("refunded")).toBe("lost");
    // Незнакомый статус не теряет заказ с доски — он в работе.
    expect(orderStage("something_new")).toBe("in_progress");
  });

  it("закрытые этапы — выполнено и потеряно", () => {
    expect(isClosedStage("won")).toBe(true);
    expect(isClosedStage("lost")).toBe(true);
    expect(isClosedStage("new")).toBe(false);
  });
});

describe("заявка: разбор и проверка ввода", () => {
  const base = {
    id: "3f0c2a8e-1b2c-4d5e-8f90-123456789abc",
    stage: "new",
    name: "Анна",
    contact: "+7 700 000 00 00",
    source: "manual",
    amount: 12000,
    currency: "KZT",
    note: "Торт на субботу",
    owner: null,
    user_key: null,
    created_at: "2026-09-27T05:00:00.000Z",
    updated_at: "2026-09-27T05:00:00.000Z",
    closed_at: null,
  };

  it("ключ заявки в app_settings — по префиксу crm:lead:", () => {
    expect(leadKey(base.id)).toBe(`crm:lead:${base.id}`);
  });

  it("читает сохранённую заявку", () => {
    expect(parseLead(JSON.stringify(base))).toEqual(base);
  });

  it("битое значение или незнакомый этап — не заявка", () => {
    expect(parseLead("abc")).toBeNull();
    expect(parseLead(JSON.stringify({ ...base, stage: "zzz" }))).toBeNull();
    expect(parseLead(JSON.stringify({ ...base, id: "../x" }))).toBeNull();
    expect(parseLead(null)).toBeNull();
  });

  it("ввод продавца обрезается и чистится", () => {
    const r = sanitizeLeadInput({
      name: "  Анна  ",
      contact: "x".repeat(500),
      note: "n".repeat(3000),
      amount: -5,
      currency: "kzt",
    });
    expect(r.name).toBe("Анна");
    expect(r.contact).toHaveLength(120);
    expect(r.note).toHaveLength(1000);
    expect(r.amount).toBeNull();
    expect(r.currency).toBe("KZT");
  });

  it("пустое имя и контакт — заявку не завести", () => {
    expect(() => sanitizeLeadInput({ name: " ", contact: "" })).toThrow();
  });
});
