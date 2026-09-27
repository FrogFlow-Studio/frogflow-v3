import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateStateSection, type Customer } from "./customers";

function setup(state: Record<string, unknown>) {
  const db = fakeDb();
  db.tables.bot_users = [{ id: "u1", user_key: "ig_1", telegram_id: -1, state }];
  const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
  // Снимок покупателя, взятый до долгой обработки, — уже устаревший.
  const customer = { userKey: "ig_1", state: {} } as unknown as Customer;
  const current = () => db.tables.bot_users![0]!.state as Record<string, never>;
  return { ctx, db, customer, current };
}

describe("updateStateSection: раздел состояния без слепой перезаписи", () => {
  it("пишет поверх свежего состояния, а не снимка; счётчик растёт", async () => {
    const { ctx, customer, current } = setup({
      mode: "idle",
      locale: "kk",
      consultant: { recent: [], profile: { city: "Алматы" }, rev: 4 },
    });
    const next = await updateStateSection(ctx, customer, "consultant", (cur) => ({
      ...cur,
      contact_asked: true,
    }));
    expect(current()).toEqual({
      mode: "idle",
      locale: "kk",
      consultant: { recent: [], profile: { city: "Алматы" }, contact_asked: true, rev: 5 },
    });
    expect(next.state).toEqual(current());
  });

  it("гонка: параллельная запись между чтением и записью не теряется", async () => {
    const { ctx, db, customer, current } = setup({ mode: "idle" });
    let calls = 0;
    await updateStateSection(ctx, customer, "consultant", (cur) => {
      calls++;
      if (calls === 1) {
        // Второе сообщение успело записать своё, пока мы собирали изменения.
        db.tables.bot_users![0]!.state = {
          mode: "idle",
          consultant: { profile: { size: "160x200" }, rev: 1 },
        };
      }
      return { ...cur, last_reply_at: "2026-09-27T21:00:00Z" };
    });
    expect(calls).toBe(2);
    expect(current()).toEqual({
      mode: "idle",
      consultant: { profile: { size: "160x200" }, last_reply_at: "2026-09-27T21:00:00Z", rev: 2 },
    });
  });

  it("смена mode ботом тоже считается гонкой: mode не откатывается", async () => {
    const { ctx, db, customer, current } = setup({ mode: "idle", consultant: { rev: 1 } });
    let calls = 0;
    await updateStateSection(ctx, customer, "consultant", (cur) => {
      if (++calls === 1)
        db.tables.bot_users![0]!.state = { mode: "checkout", consultant: { rev: 1 } };
      return { ...cur, paused_until: "x" };
    });
    expect(current()).toMatchObject({
      mode: "checkout",
      consultant: { paused_until: "x", rev: 2 },
    });
  });

  it("состояние меняется при каждой попытке — ошибка, а не слепая запись", async () => {
    const { ctx, db, customer } = setup({ consultant: { rev: 1 } });
    let rev = 1;
    await expect(
      updateStateSection(ctx, customer, "consultant", (cur) => {
        db.tables.bot_users![0]!.state = { consultant: { rev: ++rev } };
        return { ...cur, x: 1 };
      }),
    ).rejects.toThrow(/параллельно/);
    expect(db.tables.bot_users![0]!.state).toEqual({ consultant: { rev: 4 } });
  });
});
