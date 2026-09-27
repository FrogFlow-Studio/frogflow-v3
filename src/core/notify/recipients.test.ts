import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { deliverToEach } from "./deliver";
import { adminRecipients, sellerIds } from "./recipients";

describe("кто продавец магазина: получает заказ и жмёт его кнопки", () => {
  it("владелец из карточки клиента — продавец, даже если его нет в admin_chat_id", () => {
    expect(sellerIds("111, 222", 333)).toEqual(["111", "222", "333"]);
    expect(sellerIds("", 333)).toEqual(["333"]);
    expect(sellerIds(null, 333)).toEqual(["333"]);
  });

  it("без дублей и без владельца, если его нет", () => {
    expect(sellerIds("333;111", 333)).toEqual(["333", "111"]);
    expect(sellerIds("111", null)).toEqual(["111"]);
    expect(sellerIds(null, null)).toEqual([]);
  });

  it("чужой id в список не попадает", () => {
    expect(sellerIds("111", 333)).not.toContain("444");
  });
});

describe("уведомление всем менеджерам магазина", () => {
  it("уходит каждому из admin_chat_id и владельцу, а отчёт называет, кто не получил", async () => {
    const db = fakeDb();
    db.tables.app_settings = [{ bot_id: "b", key: "admin_chat_id", value: "111, 222,333" }];
    const ctx = { tenant: { id: "b", ownerTelegramId: 444 }, db } as unknown as TenantContext;
    const ids = await adminRecipients(ctx);
    expect(ids).toEqual(["111", "222", "333", "444"]);
    const sent: string[] = [];
    const r = await deliverToEach(ids, async (id) => {
      sent.push(id);
      return id === "222"
        ? { ok: false, description: "Forbidden: bot was blocked by the user" }
        : { ok: true };
    });
    expect(sent).toEqual(ids);
    expect(r.delivered).toEqual(["111", "333", "444"]);
    expect(r.failed).toEqual([
      { id: "222", reason: "заблокировал бота (Forbidden: bot was blocked by the user)" },
    ]);
  });
});
