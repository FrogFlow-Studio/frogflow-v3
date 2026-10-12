import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { Customer } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  CHAT_FOREIGN_PAY_KEY,
  CHAT_PAY_FAILED_KEY,
  CHAT_RECEIPT_TEXT_OFFER_KEY,
  CHAT_SKIP_CHATTER_KEY,
  TRIAGE_CAP_KEY,
  foreignPayApplies,
  parseTriage,
  triageSpendKey,
  triageUserPrompt,
} from "./triage";
import { setTriageModelForTests, triageMessage } from "./triage.server";
import { CHAT_RECEIPT_TEXT_KEY } from "@/core/receipts/text-receipt";

function ctx(settings: Array<{ key: string; value: string }> = []) {
  const db = fakeDb();
  db.tables.app_settings = [...settings];
  db.tables.manager_chat_messages = [];
  return { tenant: { id: "b1" }, db, timezone: "Asia/Almaty" } as unknown as TenantContext;
}
const customer = { telegramId: 1, userKey: "ig:1", state: {} } as unknown as Customer;
const NOW = Date.parse("2026-10-12T06:00:00Z");

afterEach(() => {
  setTriageModelForTests(null);
  setEnvForTests(undefined);
});

describe("ответ модели", () => {
  it("неизвестный вид — other; страна только у foreign_pay и только ISO-код", () => {
    expect(parseTriage({ kind: "chatter", country: "BY" })).toEqual({
      kind: "chatter",
      country: null,
    });
    expect(parseTriage({ kind: "foreign_pay", country: "by" })).toEqual({
      kind: "foreign_pay",
      country: "BY",
    });
    expect(parseTriage({ kind: "foreign_pay", country: "Беларусь" }).country).toBeNull();
    expect(parseTriage({ kind: "spam" }).kind).toBe("other");
    expect(parseTriage({ kind: "payment_failed", country: "BY" })).toEqual({
      kind: "payment_failed",
      country: null,
    });
    expect(parseTriage({ kind: "cant_send_receipt" }).kind).toBe("cant_send_receipt");
    // Копилка 12.10: пуш Kaspi текстом (#148), «как перейти на оплату?» (#147).
    expect(parseTriage({ kind: "text_receipt" }).kind).toBe("text_receipt");
    expect(parseTriage({ kind: "how_to_pay" }).kind).toBe("how_to_pay");
    expect(parseTriage(null).kind).toBe("other");
  });

  it("ответ про оплату — страна понятна, не Россия и у магазина нет способа для неё", () => {
    const by = { kind: "foreign_pay", country: "BY" } as const;
    expect(foreignPayApplies(by, ["KZ"])).toBe(true);
    expect(foreignPayApplies(by, ["KZ", "BY"])).toBe(false);
    expect(foreignPayApplies({ kind: "foreign_pay", country: "RU" }, ["KZ"])).toBe(false);
    expect(foreignPayApplies({ kind: "foreign_pay", country: null }, ["KZ"])).toBe(false);
    expect(foreignPayApplies({ kind: "chatter", country: null }, ["KZ"])).toBe(false);
  });

  it("в промпте — переписка и само сообщение", () => {
    const p = triageUserPrompt({
      text: "+",
      lines: [{ sender: "bot", text: "Ответьте «+», пришлю материал" }],
    });
    expect(p).toContain("Бот: Ответьте «+»");
    expect(p).toContain("Последнее сообщение покупателя: «+»");
  });
});

describe("вызов модели", () => {
  it("понимает модель; расход дня записан", async () => {
    const c = ctx();
    const model = vi.fn(async () => ({
      input: { kind: "foreign_pay", country: "BY" },
      usage: { input_tokens: 500, output_tokens: 20 },
    }));
    setTriageModelForTests(model);
    const t = await triageMessage(c, { customer, text: "В бел. руб можно", now: NOW });
    expect(t).toEqual({ kind: "foreign_pay", country: "BY" });
    expect(model).toHaveBeenCalledOnce();
    const spend = (c.db as unknown as ReturnType<typeof fakeDb>).tables.app_settings!.find(
      (s) => s.key === triageSpendKey("2026-10-12"),
    );
    expect(JSON.parse(String(spend?.value))).toEqual({ usd: 0.0012, calls: 1 });
  });

  it("все настройки выключены — модель не зовём", async () => {
    const model = vi.fn();
    setTriageModelForTests(model);
    const c = ctx([
      { key: CHAT_SKIP_CHATTER_KEY, value: "false" },
      { key: CHAT_FOREIGN_PAY_KEY, value: "false" },
      { key: CHAT_PAY_FAILED_KEY, value: "false" },
      { key: CHAT_RECEIPT_TEXT_OFFER_KEY, value: "false" },
      { key: CHAT_RECEIPT_TEXT_KEY, value: "false" },
    ]);
    expect((await triageMessage(c, { customer, text: "Спасибо", now: NOW })).kind).toBe("other");
    expect(model).not.toHaveBeenCalled();
  });

  it("подпись к фото — модель знает, что сообщение пришло с картинкой", () => {
    const p = triageUserPrompt({ text: "Не проходит", lines: [], withPhoto: true });
    expect(p).toContain("фото с подписью");
    expect(p).toContain("«Не проходит»");
  });

  it("«платёж не прошёл» выключен — исполняется как other, остальные виды работают", async () => {
    setTriageModelForTests(async () => ({ input: { kind: "payment_failed", country: "" } }));
    const off = ctx([{ key: CHAT_PAY_FAILED_KEY, value: "false" }]);
    expect((await triageMessage(off, { customer, text: "Не проходит", now: NOW })).kind).toBe(
      "other",
    );
    setTriageModelForTests(async () => ({ input: { kind: "cant_send_receipt", country: "" } }));
    const on = ctx([{ key: CHAT_PAY_FAILED_KEY, value: "false" }]);
    expect(
      (await triageMessage(on, { customer, text: "скриншот не загружается", now: NOW })).kind,
    ).toBe("cant_send_receipt");
  });

  it("выключенный вид исполняется как other", async () => {
    setTriageModelForTests(async () => ({ input: { kind: "chatter", country: "" } }));
    const c = ctx([{ key: CHAT_SKIP_CHATTER_KEY, value: "false" }]);
    expect((await triageMessage(c, { customer, text: "🔥", now: NOW })).kind).toBe("other");
  });

  it("потолок дня исчерпан, сбой модели, нет ключа — other: сообщение уходит продавцу", async () => {
    const model = vi.fn();
    setTriageModelForTests(model);
    const capped = ctx([
      { key: TRIAGE_CAP_KEY, value: "0.01" },
      { key: triageSpendKey("2026-10-12"), value: JSON.stringify({ usd: 0.02, calls: 9 }) },
    ]);
    expect((await triageMessage(capped, { customer, text: "Спасибо", now: NOW })).kind).toBe(
      "other",
    );
    expect(model).not.toHaveBeenCalled();
    setTriageModelForTests(async () => {
      throw new Error("timeout");
    });
    expect((await triageMessage(ctx(), { customer, text: "Спасибо", now: NOW })).kind).toBe(
      "other",
    );
    setTriageModelForTests(null);
    setEnvForTests({});
    expect((await triageMessage(ctx(), { customer, text: "Спасибо", now: NOW })).kind).toBe(
      "other",
    );
  });
});
