import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { orderActions } from "@/core/orders/actions";

/**
 * Кнопки карточки заказа и сервер решают одинаково (З2): действие, которого
 * нет в `orderActions`, сервер отклоняет и статус не меняет.
 */
const orders: Record<number, Record<string, unknown>> = {};
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  getOrder: async (_ctx: unknown, id: number) => orders[id] ?? null,
}));
vi.mock("./locale.server", () => ({ adminTFor: async () => (k: string) => k }));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s" }) }));

const { runOrderAction } = await import("./admin.server");

const STATUSES = [
  "awaiting_payment",
  "awaiting_confirmation",
  "paid",
  "accepted",
  "in_production",
  "ready",
  "delivered",
  "rejected",
  "cancelled",
  "refunded",
];

describe("переходы статуса: недоступное в кнопках отклоняет и сервер", () => {
  for (const kind of ["physical", "digital"])
    for (const status of STATUSES)
      for (const action of ["next", "prev"] as const)
        it(`${kind} · ${status} · ${action}`, async () => {
          const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
          db.tables.zernio_logs = [];
          db.tables.orders = [{ id: 1, status, fulfillment_kind: kind }];
          orders[1] = {
            id: 1,
            order_no: 1,
            display_no: 1,
            status,
            fulfillment_kind: kind,
            platform: "web",
            total: 100,
            currency: "KZT",
            telegram_id: -1,
            order_items: [],
          };
          const ctx = {
            tenant: { id: "b", telegramTokenEnc: null, modules: {}, settings: {} },
            db,
          } as unknown as TenantContext;
          const offered = orderActions({ status, fulfillment_kind: kind }, true).includes(action);
          const r = await runOrderAction(ctx, 1, action);
          if (!offered) {
            expect(r.ok).toBe(false);
            expect(db.tables.orders![0]!.status).toBe(status);
          } else {
            expect(r.ok).toBe(true);
            expect(db.tables.orders![0]!.status).not.toBe(status);
          }
        });
});

describe("Х4: «дальше» из «готов» в админке", () => {
  for (const [type, step] of [
    ["delivery", "shipped"],
    ["pickup", "done"],
    [null, "done"],
  ] as const)
    it(`${type ?? "без способа получения"}: шаг ${step} в журнале заказа`, async () => {
      const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
      db.tables.zernio_logs = [];
      db.tables.orders = [
        { id: 2, status: "ready", fulfillment_kind: "physical", fulfillment_type: type },
      ];
      orders[2] = {
        id: 2,
        order_no: 2,
        display_no: 2,
        status: "ready",
        fulfillment_kind: "physical",
        fulfillment_type: type,
        platform: "web",
        total: 100,
        currency: "KZT",
        telegram_id: -1,
        order_items: [],
      };
      const ctx = {
        tenant: { id: "b", telegramTokenEnc: null, modules: {}, settings: {} },
        db,
      } as unknown as TenantContext;
      const r = await runOrderAction(ctx, 2, "next");
      expect(r.ok).toBe(true);
      expect(db.tables.orders![0]!.status).toBe("delivered");
      const ev = db.tables.zernio_logs!.filter((e) => e.event_type === "order.status");
      expect(ev).toHaveLength(1);
      expect((ev[0]!.payload as Record<string, unknown>).step).toBe(step);
    });
});
