import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer } from "./customers";

// AATeach 24.10 02:31: новый покупатель прислал два сообщения разом, оба
// создавали строку, второе упало «duplicate key bot_users_pkey» — и пропало.
describe("два первых сообщения нового покупателя разом", () => {
  it("оба доходят: второй находит строку, которую создал первый", async () => {
    const db = fakeDb({ unique: { bot_users: [["user_key"]] } });
    db.tables.bot_users = [];
    const ctx = { tenant: { id: "b", modules: {}, settings: {} }, db } as unknown as TenantContext;
    const [a, b] = await Promise.all([
      upsertCustomer(ctx, "instagram", "1474993768013948", { username: "nastya" }),
      upsertCustomer(ctx, "instagram", "1474993768013948", { username: "nastya" }),
    ]);
    expect(a.userKey).toBe("ig_1474993768013948");
    expect(b.userKey).toBe("ig_1474993768013948");
    expect(db.tables.bot_users).toHaveLength(1);
  });
});
