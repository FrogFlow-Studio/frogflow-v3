import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { claimContactRequest } from "./contact-request";

/** Метка «Связаться с продавцом» достаётся одному сообщению из нескольких. */
function setup(state: Record<string, unknown>) {
  const db = fakeDb();
  db.tables.bot_users = [{ id: "u1", bot_id: "b", user_key: "ig_1", state }];
  const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
  const customer = { userKey: "ig_1", state } as unknown as Customer;
  return { db, ctx, customer };
}

describe("метка «Связаться с продавцом»", () => {
  it("два сообщения подряд — метку забирает одно, остальное в state цело", async () => {
    const at = new Date().toISOString();
    const { db, ctx, customer } = setup({
      mode: "idle",
      locale: "ru",
      direct: { contact_requested_at: at, last_reply: "x" },
    });
    const [a, b] = await Promise.all([
      claimContactRequest(ctx, customer),
      claimContactRequest(ctx, customer),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const saved = db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(saved).toEqual({ mode: "idle", locale: "ru", direct: { last_reply: "x" } });
    expect(await claimContactRequest(ctx, customer)).toBeNull();
  });

  it("шаг диалога сменился между чтением и записью — метку не забираем", async () => {
    const at = new Date().toISOString();
    const { db, ctx, customer } = setup({ direct: { contact_requested_at: at } });
    const from = db.from.bind(db);
    let calls = 0;
    (ctx as { db: unknown }).db = {
      from: (t: string) => {
        // Второй вызов — наша условная запись; перед ней бот успел сменить шаг.
        if (++calls === 2)
          db.tables.bot_users![0]!.state = {
            direct: { contact_requested_at: at },
            mode: "awaiting_contact",
          };
        return from(t);
      },
    };
    expect(await claimContactRequest(ctx, customer)).toBeNull();
  });

  it("метки нет или она старше суток — null", async () => {
    expect(await claimContactRequest(setup({}).ctx, setup({}).customer)).toBeNull();
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    const s = setup({ direct: { contact_requested_at: old } });
    expect(await claimContactRequest(s.ctx, s.customer)).toBeNull();
  });
});
