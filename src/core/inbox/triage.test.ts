import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { Customer } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  CHAT_FOREIGN_PAY_KEY,
  CHAT_HOW_TO_BUY_KEY,
  CHAT_KEEP_UNREAD_KEY,
  CHAT_PAY_FAILED_KEY,
  CHAT_PRODUCT_REQUEST_KEY,
  CHAT_RECEIPT_TEXT_OFFER_KEY,
  CHAT_SEVERAL_ITEMS_KEY,
  CHAT_SKIP_CHATTER_KEY,
  TRIAGE_CAP_KEY,
  TRIAGE_SYSTEM,
  countryName,
  foreignOrderApplies,
  foreignPayApplies,
  kaspiForeignApplies,
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
    // Копилка 12.10, kramiliia #159: страна покупателя нужна и у «не получится».
    expect(parseTriage({ kind: "payment_failed", country: "kg" })).toEqual({
      kind: "payment_failed",
      country: "KG",
    });
    expect(parseTriage({ kind: "how_to_buy", country: "KZ" })).toEqual({
      kind: "how_to_buy",
      country: null,
    });
    expect(parseTriage({ kind: "cant_send_receipt" }).kind).toBe("cant_send_receipt");
    // Копилка 12.10: пуш Kaspi текстом (#148), «как перейти на оплату?» (#147).
    expect(parseTriage({ kind: "text_receipt" }).kind).toBe("text_receipt");
    expect(parseTriage({ kind: "how_to_pay" }).kind).toBe("how_to_pay");
    // Копилка 13.10: «2 материала одним чеком» (#190), «Классный уголок» без правила.
    expect(parseTriage({ kind: "several_items", country: "KG" })).toEqual({
      kind: "several_items",
      country: null,
    });
    expect(parseTriage({ kind: "product_request" }).kind).toBe("product_request");
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

  it("Kaspi из другой страны — заказ на Kaspi, страна понятна, не Казахстан и не Россия, способа для неё нет", () => {
    expect(kaspiForeignApplies("KG", "KZ", ["KZ"])).toBe(true);
    expect(kaspiForeignApplies("KG", "KZ", ["KZ", "KG"])).toBe(false);
    expect(kaspiForeignApplies("KZ", "KZ", ["KZ"])).toBe(false);
    expect(kaspiForeignApplies("RU", "KZ", ["KZ"])).toBe(false);
    expect(kaspiForeignApplies(null, "KZ", ["KZ"])).toBe(false);
    expect(kaspiForeignApplies("KG", "RU", ["KZ", "RU"])).toBe(false);
  });

  it("заказ без Kaspi и карты РФ — страна сказана, не Казахстан и не Россия, способа для неё нет", () => {
    expect(foreignOrderApplies("KG", ["KZ"])).toBe(true);
    expect(foreignOrderApplies("BY", ["KZ", "RU"])).toBe(true);
    expect(foreignOrderApplies("KG", ["KZ", "KG"])).toBe(false);
    expect(foreignOrderApplies("KZ", ["KZ"])).toBe(false);
    expect(foreignOrderApplies("RU", ["KZ"])).toBe(false);
    expect(foreignOrderApplies(null, ["KZ"])).toBe(false);
    expect(foreignOrderApplies("", ["KZ"])).toBe(false);
  });

  it("название страны покупателю — на его языке", () => {
    expect(countryName("KG", "ru")).toBe("Кыргызстан");
    expect(countryName("UZ", "ru")).toBe("Узбекистан");
    expect(countryName("KG", "en")).toBe("Kyrgyzstan");
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
  it("«как получить?» выключено — other", async () => {
    setTriageModelForTests(async () => ({ input: { kind: "how_to_buy", country: "" } }));
    const on = ctx();
    expect((await triageMessage(on, { customer, text: "Как можно получить", now: NOW })).kind).toBe(
      "how_to_buy",
    );
    const off = ctx([{ key: CHAT_HOW_TO_BUY_KEY, value: "false" }]);
    expect(
      (await triageMessage(off, { customer, text: "Как можно получить", now: NOW })).kind,
    ).toBe("other");
  });

  it("«несколько одним чеком» и название без товара — свои переключатели", async () => {
    for (const [kind, key] of [
      ["several_items", CHAT_SEVERAL_ITEMS_KEY],
      ["product_request", CHAT_PRODUCT_REQUEST_KEY],
    ] as const) {
      setTriageModelForTests(async () => ({ input: { kind, country: "" } }));
      expect(
        (await triageMessage(ctx(), { customer, text: "Классный уголок", now: NOW })).kind,
      ).toBe(kind);
      const off = ctx([{ key, value: "false" }]);
      expect((await triageMessage(off, { customer, text: "Классный уголок", now: NOW })).kind).toBe(
        "other",
      );
    }
  });

  it("«Не отвечать на обычные сообщения» — ответы вне шага оплаты молчат, шаг оплаты отвечает", async () => {
    const quiet = () => ctx([{ key: CHAT_KEEP_UNREAD_KEY, value: "true" }]);
    for (const kind of ["several_items", "product_request", "how_to_buy", "foreign_pay"] as const) {
      setTriageModelForTests(async () => ({ input: { kind, country: "BY" } }));
      expect(
        (await triageMessage(quiet(), { customer, text: "Хотела бы купить", now: NOW })).kind,
      ).toBe("other");
    }
    for (const kind of ["payment_failed", "chatter"] as const) {
      setTriageModelForTests(async () => ({ input: { kind, country: "" } }));
      expect((await triageMessage(quiet(), { customer, text: "Не проходит", now: NOW })).kind).toBe(
        kind,
      );
    }
  });

  it("«хочу купить эти материалы» без «одним чеком» — не several_items (AATeach 15.10)", () => {
    expect(TRIAGE_SYSTEM).toContain("«Хотела бы купить данные материалы»");
    expect(TRIAGE_SYSTEM).toMatch(/не several_items, а other/);
  });

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
      { key: CHAT_HOW_TO_BUY_KEY, value: "false" },
      { key: CHAT_SEVERAL_ITEMS_KEY, value: "false" },
      { key: CHAT_PRODUCT_REQUEST_KEY, value: "false" },
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
