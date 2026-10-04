import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { showable, todayTasks } from "./today";

const T = "11111111-2222-3333-4444-555555555555";

function setup(modules: Record<string, boolean> = {}, broken: string[] = []) {
  const db = fakeDb({});
  db.tables.orders = [
    { id: 1, bot_id: T, status: "awaiting_confirmation" },
    { id: 2, bot_id: T, status: "awaiting_confirmation" },
    { id: 3, bot_id: T, status: "accepted" },
    { id: 4, bot_id: T, status: "delivered" },
  ];
  db.tables.manager_chat_state = [{ bot_id: T, telegram_id: 1, unread_count: 3 }];
  const ctx = {
    tenant: { id: T, modules, settings: { served_by: "v2" } },
    db: broken.length ? withBrokenReads(db, broken) : db,
  } as unknown as TenantContext;
  return ctx;
}
const by = (r: Awaited<ReturnType<typeof todayTasks>>) =>
  Object.fromEntries(r.map((t) => [t.key, t.count]));

describe("«Что сделать сегодня»", () => {
  it("считает ожидающее и не показывает нули", async () => {
    const r = await todayTasks(setup());
    expect(by(r)).toEqual({ receipts: 2, newOrders: 1 });
  });

  it("чат — только при включённом модуле", async () => {
    expect(by(await todayTasks(setup()))).not.toHaveProperty("dialogs");
    expect(by(await todayTasks(setup({ manager_chat: true })))).toHaveProperty("dialogs", 3);
  });

  it("сбой чтения — «не удалось» (null), а не 0; остальные строки живы", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = by(await todayTasks(setup({ manager_chat: true }, ["manager_chat_state"])));
    expect(r.dialogs).toBeNull();
    expect(r.receipts).toBe(2);
  });

  it("сбой чтения заказов даёт null у всех трёх строк заказов", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = by(await todayTasks(setup({}, ["orders"])));
    expect(r).toEqual({ receipts: null, newOrders: null, ready: null });
  });

  it("порядок строк фиксирован, ноль скрыт, null виден", () => {
    expect(
      showable([
        { key: "lowStock", count: 1 },
        { key: "ready", count: 0 },
        { key: "receipts", count: null },
        { key: "dialogs", count: 2 },
      ]).map((t) => t.key),
    ).toEqual(["receipts", "dialogs", "lowStock"]);
  });
});
