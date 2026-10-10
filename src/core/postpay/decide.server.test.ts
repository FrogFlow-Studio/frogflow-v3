import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { Customer } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { decidePostPay, setPostpayModelForTests } from "./decide.server";
import {
  POSTPAY_CAP_KEY,
  POSTPAY_ENABLED_KEY,
  postpaySpendKey,
  type PostPayFacts,
} from "./postpay";

const NOW = Date.parse("2026-10-10T05:00:00Z");
let db: FakeDb;
let calls: string[];
const ctx = () =>
  ({
    tenant: { id: "bot-1", name: "Копилка" },
    db,
    timezone: "Asia/Almaty",
  }) as unknown as TenantContext;
const customer = { telegramId: -5, state: {} } as unknown as Customer;
const facts: PostPayFacts = {
  orderId: 1,
  orderNo: 82,
  status: "delivered",
  items: ["Палитра"],
  email: "anna@mail.ru",
  emailSentAt: "2026-10-10T04:41:00Z",
  emailFailed: false,
  resends: 0,
};
const ask = (text = "Отправьте на почту") =>
  decidePostPay(ctx(), { customer, facts, text, now: NOW });

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.manager_chat_messages = [];
  calls = [];
  setPostpayModelForTests(async (_s, user) => {
    calls.push(user);
    return {
      input: { action: "status", email: "" },
      usage: { input_tokens: 800, output_tokens: 20 },
    };
  });
});

describe("ИИ после оплаты: вызов модели", () => {
  it("решение модели и расход дня записан", async () => {
    expect(await ask()).toEqual({ action: "status", email: null });
    expect(calls).toHaveLength(1);
    const spend = db.tables.app_settings!.find((r) => r.key === postpaySpendKey("2026-10-10"));
    expect(JSON.parse(String(spend?.value))).toEqual({ usd: 0.0018, calls: 1 });
  });

  it("выключено у клиента — модель не зовём", async () => {
    db.tables.app_settings!.push({ bot_id: "bot-1", key: POSTPAY_ENABLED_KEY, value: "off" });
    expect((await ask()).action).toBe("pass");
    expect(calls).toHaveLength(0);
  });

  it("потолок дня исчерпан — модель не зовём", async () => {
    db.tables.app_settings!.push(
      { bot_id: "bot-1", key: POSTPAY_CAP_KEY, value: "0.01" },
      { bot_id: "bot-1", key: postpaySpendKey("2026-10-10"), value: '{"usd":0.01,"calls":5}' },
    );
    expect((await ask()).action).toBe("pass");
    expect(calls).toHaveLength(0);
  });

  it("сбой модели — pass, сообщение идёт прежним путём", async () => {
    setPostpayModelForTests(async () => {
      throw new Error("timeout");
    });
    expect((await ask()).action).toBe("pass");
  });

  it("длинное сообщение — это переписка, модель не зовём", async () => {
    expect((await ask("а".repeat(700))).action).toBe("pass");
    expect(calls).toHaveLength(0);
  });
});
