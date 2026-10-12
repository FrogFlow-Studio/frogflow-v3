import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { syntheticTelegramId, upsertCustomer } from "./customers";

let db: FakeDb;
const ctx = () =>
  ({ tenant: { id: "b", modules: {}, settings: {} }, db }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb();
  db.tables.bot_users = [
    // Строка Instagram из августа: telegram_id пуст (tambieva_74, AATeach 12.10).
    {
      user_key: "ig_1545",
      telegram_id: null,
      platform: "instagram",
      state: { country_code: "RU" },
    },
    { user_key: "tg_9", telegram_id: 9, platform: "telegram", state: {} },
  ];
});

describe("покупатель Instagram без telegram_id", () => {
  it("получает id при первом же сообщении: оформление находит его, а не отвечает «уже выполняется»", async () => {
    const c = await upsertCustomer(ctx(), "instagram", "1545", { username: "tambieva_74" });
    const id = syntheticTelegramId("ig_1545");
    expect(id).toBeLessThan(0);
    expect(c.telegramId).toBe(id);
    expect(db.tables.bot_users![0]!.telegram_id).toBe(id);
    // Состояние не потеряно.
    expect(c.state).toEqual({ country_code: "RU" });
  });

  it("id, который уже есть, не переписывается", async () => {
    const c = await upsertCustomer(ctx(), "telegram", 9, {});
    expect(c.telegramId).toBe(9);
    expect(db.tables.bot_users![1]!.telegram_id).toBe(9);
  });
});
