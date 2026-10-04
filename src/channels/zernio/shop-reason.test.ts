import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";

/** Direct/WhatsApp: каждый ответ бота в «Чате» несёт причину («Почему бот так ответил»). */
function shop() {
  const state = { locale: "ru", mode: "idle" };
  const db = fakeDb({ rpc: { manager_chat_touch: () => undefined } });
  db.tables.bot_users = [
    { user_key: "ig_1", platform: "instagram", telegram_id: -1, loyalty_points: 0, state },
  ];
  db.tables.app_settings = [];
  db.tables.manager_chat_state = [];
  db.tables.manager_chat_messages = [];
  db.tables.manager_chat_reasons = [];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: { manager_chat: true },
      settings: {},
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const transport = {
    send: vi.fn(async () => ({ ok: true })),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "ig_1",
    platform: "instagram",
    telegramId: -1,
    loyaltyPoints: 0,
    state,
  } as unknown as Customer;
  const say = (text: string) => {
    customer.state = db.tables.bot_users![0]!.state as Customer["state"];
    return handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "conv-1",
        accountId: "acc-1",
        platform: "instagram",
        text,
        postbackPayload: null,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  };
  const reasons = () => (db.tables.manager_chat_reasons ?? []).map((r) => r.reason as string);
  return { say, reasons };
}

describe("Direct: причина ответа записывается вместе с ответом", () => {
  it("«каталог» — ответ с причиной «команда каталог», в ней нет текста покупателя", async () => {
    const t = shop();
    await t.say("каталог");
    const reasons = t.reasons();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toContain("cmd=catalog");
    expect(reasons.join(" ")).not.toContain("каталог");
  });

  it("номер телефона вместо кода — причина говорит, что он пропущен", async () => {
    const t = shop();
    await t.say("+7 701 123 45 67");
    expect(t.reasons().join(" ")).toContain("skipped=phone");
  });
});
