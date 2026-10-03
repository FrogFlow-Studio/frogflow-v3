import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Чтение пульса: все клиенты разом, постранично, ошибка чтения — не «затих». */
let db: FakeDb;
let orders: Record<string, unknown>[];
let logins: Record<string, unknown>[];
let logs: Record<string, unknown>[];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const { loadPulse } = await import("./pulse.server");

const now = new Date("2026-10-20T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const A = "a0000000-0000-0000-0000-000000000001";
const B = "b0000000-0000-0000-0000-000000000002";
const client = (id: string) => ({ id, status: "active", createdAt: ago(300), lastOrderAt: ago(1) });

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [];
  db.tables.admin_login_attempts = [];
  orders = db.tables.orders;
  logins = db.tables.admin_login_attempts;
  db.tables.zernio_logs = [];
  logs = db.tables.zernio_logs;
});

describe("loadPulse", () => {
  it("считает заказы и последний успешный вход по каждому клиенту", async () => {
    let id = 1;
    // A: 1500 заказов за последние 14 дней — больше одной страницы чтения.
    for (let i = 0; i < 1500; i++) orders.push({ id: id++, bot_id: A, created_at: ago(2) });
    for (let i = 0; i < 4; i++) orders.push({ id: id++, bot_id: B, created_at: ago(20) });
    orders.push({ id: id++, bot_id: B, created_at: ago(40) }); // вне окна
    orders.push({ id: id++, bot_id: "other", created_at: ago(1) }); // не наш клиент
    logins.push(
      { id: "1", bot_id: A, at: ago(9), ok: true },
      { id: "2", bot_id: A, at: ago(3), ok: true },
      { id: "3", bot_id: A, at: ago(1), ok: false },
      { id: "4", bot_id: B, at: ago(30), ok: true },
    );
    const m = await loadPulse([client(A), client(B)], now);
    expect(m.get(A)).toMatchObject({ recent: 1500, previous: 0, daysSinceLogin: 3, quiet: false });
    expect(m.get(B)).toMatchObject({ recent: 0, previous: 4, ordersDropped: true, noLogin: true });
    expect(m.get(B)?.quiet).toBe(true);
  });

  it("продавец не заходил в админку, но подтверждал заказы в Telegram — не затих", async () => {
    const ev = (id: string, bot: string, actor: string, status = "event") => ({
      id,
      bot_id: bot,
      event_type: "order.status",
      status,
      created_at: ago(2),
      payload: { order_id: 1, actor },
    });
    logs.push(
      ev("1", A, "admin"), // подтвердил заказ в боте
      ev("2", B, "bot"), // только автоматика
    );
    logins.push(
      { id: "1", bot_id: A, at: ago(30), ok: true },
      { id: "2", bot_id: B, at: ago(30), ok: true },
    );
    orders.push({ id: 1, bot_id: A, created_at: ago(1) }, { id: 2, bot_id: B, created_at: ago(1) });
    const m = await loadPulse([client(A), client(B)], now);
    expect(m.get(A)).toMatchObject({ noLogin: false, quiet: false });
    expect(m.get(B)).toMatchObject({ noLogin: true, quiet: true });
  });

  for (const table of ["orders", "admin_login_attempts", "zernio_logs"])
    it(`${table}: база вернула { data: null, error } — исключение, а не пустой пульс`, async () => {
      const orig = db.from.bind(db);
      db.from = ((t: string) => {
        if (t !== table) return orig(t);
        const q: Record<string, unknown> = {};
        for (const m of ["select", "gte", "eq", "order", "like", "in"]) q[m] = () => q;
        q.range = async () => ({ data: null, error: { message: "база недоступна" } });
        return q;
      }) as unknown as typeof db.from;
      await expect(loadPulse([client(A)], now)).rejects.toThrow(/не прочитан/);
    });

  it("без клиентов в базу не ходит", async () => {
    expect((await loadPulse([], now)).size).toBe(0);
  });
});
