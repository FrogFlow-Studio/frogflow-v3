import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Трек-номер из админки (Х5): заказ отправлен, покупателю уходит номер и ссылка — один раз. */
const notified: Array<{ platform: string; text: string }> = [];
const orders: Record<number, Record<string, unknown>> = {};
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  getOrder: async (_ctx: unknown, id: number) => orders[id] ?? null,
}));
vi.mock("./locale.server", () => ({ adminTFor: async () => (k: string) => k }));
vi.mock("@/core/storefront/web-notify", () => ({
  emailOrderNotice: async (_ctx: unknown, _o: unknown, text: string) => {
    notified.push({ platform: "web", text });
    return true;
  },
}));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s" }) }));

const { runOrderTracking } = await import("./admin.server");

function shop() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: { id: "b", telegramTokenEnc: null, modules: {}, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

function seed(db: ReturnType<typeof shop>["db"], id: number, over: Record<string, unknown> = {}) {
  const row = {
    id,
    order_no: id,
    display_no: id,
    status: "ready",
    fulfillment_kind: "physical",
    fulfillment_type: "delivery",
    platform: "web",
    total: 100,
    currency: "KZT",
    telegram_id: -1,
    customer_email: "a@b.kz",
    order_items: [],
    ...over,
  };
  db.tables.orders = [...(db.tables.orders ?? []), { ...row }];
  orders[id] = row;
}

const order = (db: ReturnType<typeof shop>["db"], id: number) =>
  db.tables.orders!.find((o) => o.id === id)!;
const logs = (db: ReturnType<typeof shop>["db"], type: string) =>
  db.tables.zernio_logs!.filter((e) => e.event_type === type);

beforeEach(() => {
  notified.length = 0;
  for (const k of Object.keys(orders)) delete orders[Number(k)];
});

describe("трек-номер из админки", () => {
  it("собранный заказ с доставкой: отправлен, шаг shipped, покупателю номер и ссылка СДЭК", async () => {
    const { ctx, db } = shop();
    seed(db, 1);
    const r = await runOrderTracking(ctx, 1, "1234567890");
    expect(r.ok).toBe(true);
    expect(order(db, 1).status).toBe("delivered");
    expect(logs(db, "order.status")[0]!.payload).toMatchObject({
      to: "delivered",
      step: "shipped",
    });
    expect(logs(db, "order.tracking")[0]!.payload).toMatchObject({
      number: "1234567890",
      carrier: "cdek",
    });
    expect(notified).toHaveLength(1);
    expect(notified[0]!.text).toContain("1234567890");
    expect(notified[0]!.text).toContain("https://www.cdek.ru/ru/tracking?order_id=1234567890");
  });

  it("Казпочта: номер и ссылка на сайт Казпочты", async () => {
    const { ctx, db } = shop();
    seed(db, 1);
    await runOrderTracking(ctx, 1, "rr123456789kz");
    expect(notified[0]!.text).toContain("RR123456789KZ");
    expect(notified[0]!.text).toContain("https://post.kz/");
  });

  it("повтор того же номера и двойной клик: одно письмо и одно событие", async () => {
    const { ctx, db } = shop();
    seed(db, 1);
    const rs = await Promise.all([
      runOrderTracking(ctx, 1, "1234567890"),
      runOrderTracking(ctx, 1, "1234567890"),
    ]);
    await runOrderTracking(ctx, 1, "1234567890");
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(logs(db, "order.tracking")).toHaveLength(1);
    expect(logs(db, "order.status")).toHaveLength(1);
  });

  it("исправленный номер у уже отправленного заказа уходит новым сообщением", async () => {
    const { ctx, db } = shop();
    seed(db, 1);
    await runOrderTracking(ctx, 1, "1234567890");
    const r = await runOrderTracking(ctx, 1, "9876543210");
    expect(r.ok).toBe(true);
    expect(notified).toHaveLength(2);
    expect(logs(db, "order.status")).toHaveLength(1);
  });

  it("чужой или несуществующий заказ — «не найдено», ничего не уходит", async () => {
    const { ctx, db } = shop();
    const r = await runOrderTracking(ctx, 99, "1234567890");
    expect(r).toEqual({ ok: false, message: "err.admin.orderNotFound" });
    expect(notified).toEqual([]);
    expect(db.tables.zernio_logs).toEqual([]);
  });

  it("не номер: отказ, статус не меняется", async () => {
    const { ctx, db } = shop();
    seed(db, 1);
    const r = await runOrderTracking(ctx, 1, "не номер");
    expect(r).toEqual({ ok: false, message: "msg.orders.trackBad" });
    expect(order(db, 1).status).toBe("ready");
    expect(notified).toEqual([]);
  });

  for (const [name, over] of [
    [" ещё в работе", { status: "in_production" }],
    ["самовывоз", { fulfillment_type: "pickup" }],
    ["цифровой", { fulfillment_kind: "digital", fulfillment_type: null }],
    ["отклонён", { status: "rejected" }],
  ] as const)
    it(`${name}: отказ на сервере, ничего не пишется и не уходит`, async () => {
      const { ctx, db } = shop();
      seed(db, 1, over);
      const before = order(db, 1).status;
      const r = await runOrderTracking(ctx, 1, "1234567890");
      expect(r).toEqual({ ok: false, message: "msg.orders.trackNeedReady" });
      expect(order(db, 1).status).toBe(before);
      expect(notified).toEqual([]);
      expect(db.tables.zernio_logs).toEqual([]);
    });

  it("ручной заказ без чата: заказ отправлен, но честно «не ушло», повтор не шлётся", async () => {
    const { ctx, db } = shop();
    seed(db, 1, { platform: "manual" });
    const r = await runOrderTracking(ctx, 1, "1234567890");
    expect(r).toEqual({ ok: false, message: "msg.orders.trackNotSent" });
    expect(order(db, 1).status).toBe("delivered");
    expect(logs(db, "order.tracking")).toHaveLength(1);
    const again = await runOrderTracking(ctx, 1, "1234567890");
    expect(again.message).toBe("msg.orders.trackAlready");
  });
});
