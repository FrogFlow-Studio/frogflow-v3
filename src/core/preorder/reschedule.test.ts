import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isMove, notifyPreorderMoved, openPreorderOrders } from "./reschedule";

const BOT = "00000000-0000-0000-0000-000000000001";
const PRODUCT = "prod-1";
const NOW = Date.parse("2026-10-04T10:00:00Z");
const MOVE = { productId: PRODUCT, name: "Торт", from: "2026-10-20", to: "2026-11-05" };

function setup() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  const preorderEvent = (orderId: number, product = PRODUCT) => ({
    id: `ev-${orderId}`,
    bot_id: BOT,
    event_id: `order:${orderId}:preorder:x`,
    event_type: "order.preorder",
    status: "event",
    payload: {
      order_id: orderId,
      lines: [{ product_id: product, quantity: 1, from: "2026-10-20" }],
    },
  });
  const order = (id: number, platform: string, status = "accepted", tg = id) => ({
    id,
    bot_id: BOT,
    display_no: id,
    order_no: id,
    platform,
    status,
    telegram_id: tg,
    user_key: null,
  });
  db.tables.zernio_logs = [
    preorderEvent(1),
    preorderEvent(2),
    preorderEvent(3),
    preorderEvent(4),
    preorderEvent(5, "other-product"),
  ];
  db.tables.orders = [
    order(1, "telegram"),
    order(2, "instagram", "paid", -2),
    order(3, "telegram", "delivered"),
    order(4, "web"),
    order(5, "telegram"),
  ];
  db.tables.manager_chat_messages = [
    {
      id: "m",
      bot_id: BOT,
      telegram_id: -2,
      direction: "in",
      created_at: new Date(NOW - 30 * 3_600_000).toISOString(),
    },
  ];
  db.tables.bot_users = [];
  const ctx = {
    tenant: { id: BOT, modules: {}, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("перенос срока предзаказа", () => {
  it("перенос — когда предзаказ был и остался, а дата другая", () => {
    expect(isMove({ from: "2026-10-20" }, { from: "2026-11-05" })).toBe(true);
    expect(isMove({ from: "2026-10-20" }, { from: "2026-10-20" })).toBe(false);
    expect(isMove(null, { from: "2026-10-20" })).toBe(false);
    expect(isMove({ from: "2026-10-20" }, null)).toBe(false);
    expect(isMove({ from: null }, { from: "2026-10-20" })).toBe(true);
  });

  it("открытые заказы именно на этот товар: доставленные и чужие товары не входят", async () => {
    const { ctx } = setup();
    expect((await openPreorderOrders(ctx, PRODUCT)).map((o) => o.id)).toEqual([1, 2, 4]);
  });

  it("Telegram — сообщение; Direct вне окна 24 часа и сайт — в список «не смогли»; события в истории", async () => {
    const { db, ctx } = setup();
    const send = vi.fn(async () => true);
    const r = await notifyPreorderMoved(ctx, MOVE, send, { now: () => NOW });
    expect(r.notified).toBe(1);
    expect(r.missed.map((o) => o.id)).toEqual([2, 4]);
    expect(send).toHaveBeenCalledTimes(1);
    const types = db.tables.zernio_logs!.map((e) => e.event_type);
    expect(types.filter((t) => t === "order.preorder_moved")).toHaveLength(3);
    expect(types.filter((t) => t === "order.notify_failed")).toHaveLength(2);
  });

  it("Direct внутри окна — сообщение уходит", async () => {
    const { db, ctx } = setup();
    db.tables.manager_chat_messages![0]!.created_at = new Date(NOW - 2 * 3_600_000).toISOString();
    const send = vi.fn(async () => true);
    const r = await notifyPreorderMoved(ctx, MOVE, send, { now: () => NOW });
    expect(r.notified).toBe(2);
    expect(r.missed.map((o) => o.id)).toEqual([4]);
  });

  it("два сохранения подряд или одновременно — одно сообщение на заказ", async () => {
    const { ctx } = setup();
    const send = vi.fn(async () => true);
    const [a, b] = await Promise.all([
      notifyPreorderMoved(ctx, MOVE, send, { now: () => NOW }),
      notifyPreorderMoved(ctx, MOVE, send, { now: () => NOW }),
    ]);
    expect(a.notified + b.notified).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    // и повторное сохранение того же переноса молчит
    const again = await notifyPreorderMoved(ctx, MOVE, send, { now: () => NOW });
    expect(again).toMatchObject({ notified: 0, missed: [] });
  });

  it("новый перенос на другую дату — новое сообщение", async () => {
    const { ctx } = setup();
    const send = vi.fn(async () => true);
    await notifyPreorderMoved(ctx, MOVE, send, { now: () => NOW });
    const r = await notifyPreorderMoved(
      ctx,
      { ...MOVE, from: "2026-11-05", to: "2026-12-01" },
      send,
      {
        now: () => NOW,
      },
    );
    expect(r.notified).toBe(1);
  });
});
