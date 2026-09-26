import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer, DialogState } from "@/core/customers/customers";
import { releaseOrderPlacement } from "./orders";

function setup(state: DialogState) {
  const db = fakeDb();
  db.tables.bot_users = [{ id: "u1", user_key: "tg:42", telegram_id: 42, state: { ...state } }];
  const ctx = { tenant: { id: "t-placement" }, db } as unknown as TenantContext;
  const customer = { userKey: "tg:42", telegramId: 42, platform: "telegram", state } as Customer;
  return { db, ctx, customer };
}

describe("releaseOrderPlacement", () => {
  it("снимает флаг оформления, не трогая остальной state", async () => {
    const { db, ctx, customer } = setup({
      country_code: "KZ",
      country_name: "Казахстан",
      locale: "kk",
      placing_order: true,
    });
    await releaseOrderPlacement(ctx, customer);
    expect(db.tables.bot_users![0]!.state).toEqual({
      country_code: "KZ",
      country_name: "Казахстан",
      locale: "kk",
    });
  });
});
