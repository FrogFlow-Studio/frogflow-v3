import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/core/settings/settings", () => ({ getSettings: async () => ({}) }));

const { markPaidOnline } = await import("./payment");

let db: FakeDb;
const ctx = () => ({ tenant: { id: "shop-1", modules: {} }, db }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [
    {
      id: 7,
      bot_id: "shop-1",
      status: "awaiting_payment",
      fulfillment_kind: "digital",
      admin_note: null,
      paid_amount: 0,
      total: 3000,
      currency: "KZT",
    },
  ];
  db.tables.zernio_logs = [];
});

describe("онлайн-оплата пишет платёж в журнал заказа", () => {
  it("первый колбэк — событие payment с суммой и шлюзом, повтор — ничего", async () => {
    expect(await markPaidOnline(ctx(), 7, 3000, "Robokassa", "7")).toMatchObject({
      ok: true,
      alreadyDone: false,
    });
    expect(await markPaidOnline(ctx(), 7, 3000, "Robokassa")).toMatchObject({ alreadyDone: true });
    const events = db.tables.zernio_logs!.filter((e) => e.event_type === "order.payment");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      order_id: 7,
      amount: 3000,
      currency: "KZT",
      source: "online",
      provider: "Robokassa",
      invId: "7",
    });
  });
});

describe("сбой базы в колбэке оплаты", () => {
  const brokenCtx = (failOn: "read" | "update") => {
    const real = ctx();
    const failing = (): unknown => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "update"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: { message: "connection reset" } });
      return chain;
    };
    return {
      ...real,
      db: {
        from: (t: string) => {
          const builder = (db as FakeDb).from(t) as unknown as {
            update: (...a: unknown[]) => unknown;
          };
          if (failOn === "read") return failing();
          return new Proxy(builder, {
            get: (target, key) =>
              key === "update"
                ? () => failing()
                : (target as Record<string | symbol, unknown>)[key],
          });
        },
      },
    } as unknown as TenantContext;
  };

  it("не прочитался заказ — сбой (шлюз повторит колбэк), а не «заказ не найден»", async () => {
    await expect(markPaidOnline(brokenCtx("read"), 7, 3000, "Robokassa", "7")).rejects.toThrow(
      /не прочитан заказ #7/,
    );
    expect(db.tables.orders![0]!.status).toBe("awaiting_payment");
  });

  it("не записалась оплата — сбой, заказ не помечен оплаченным, события в журнале нет", async () => {
    await expect(markPaidOnline(brokenCtx("update"), 7, 3000, "Robokassa", "7")).rejects.toThrow(
      /не записана оплата заказа #7/,
    );
    expect(db.tables.orders![0]!.status).toBe("awaiting_payment");
    expect(db.tables.zernio_logs).toHaveLength(0);
  });
});
