import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listBlocked, listCustomers, setBlocked } from "./admin";

const BOT = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

function setup() {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.bot_users = [
    {
      bot_id: BOT,
      user_key: "tg:1",
      platform: "telegram",
      telegram_id: 1,
      username: "anna",
      first_name: "Анна",
      loyalty_points: 0,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  // Человек 2 заблокирован ещё в v1: бот ему молчит и покупателя не заводит.
  db.tables.blocked_users = [
    { bot_id: BOT, telegram_id: 2, username: "boris", first_name: "Борис", reason: null },
    { bot_id: OTHER, telegram_id: 3, username: "other", first_name: null, reason: null },
  ];
  const ctx = { tenant: { id: BOT, modules: { blocked: true } }, db } as unknown as TenantContext;
  return { ctx, db };
}

describe("чёрный список в «Покупателях»", () => {
  it("показывает заблокированного без записи покупателя, только своего клиента", async () => {
    const { ctx } = setup();
    const blocked = await listBlocked(ctx);
    expect(blocked).toEqual([
      { telegram_id: 2, username: "boris", first_name: "Борис", reason: null },
    ]);
    const rows = await listCustomers(ctx);
    expect(rows.map((r) => r.telegram_id)).toEqual([1]);
  });

  it("«Разблокировать» из этого списка снимает блок: строки больше нет", async () => {
    const { ctx, db } = setup();
    await setBlocked(ctx, 2, false);
    expect(await listBlocked(ctx)).toEqual([]);
    expect(db.tables.blocked_users!.map((r) => r.telegram_id)).not.toContain(2);
  });

  it("чёрный список больше одной страницы читается целиком", async () => {
    const { ctx, db } = setup();
    db.tables.blocked_users = Array.from({ length: 2500 }, (_, i) => ({
      bot_id: BOT,
      telegram_id: 1000 + i,
      username: null,
      first_name: null,
      reason: null,
    }));
    expect(await listBlocked(ctx)).toHaveLength(2500);
  });

  it("не прочиталось — ошибка, а не «никто не заблокирован»", async () => {
    const { ctx } = setup();
    const broken = {
      ...ctx,
      db: {
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        }),
      },
    } as unknown as TenantContext;
    await expect(listBlocked(broken)).rejects.toThrow();
  });

  it("поиск по «@ник» находит покупателя (ник в базе без собачки)", async () => {
    const { ctx } = setup();
    const rows = await listCustomers(ctx, "@anna");
    expect(rows.map((r) => r.telegram_id)).toEqual([1]);
  });
});
