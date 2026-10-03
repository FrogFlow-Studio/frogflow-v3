import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/core/settings/settings", () => ({ getSettings: async () => ({}) }));

const { markPaidOnline, recordUnappliedPayment } = await import("./payment");

let db: FakeDb;
const ctx = () => ({ tenant: { id: "shop-1", modules: {} }, db }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
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

describe("оплата по закрытому заказу и несовпавшая сумма", () => {
  const details = { amount: 3000, currency: "KZT", provider: "Stripe", ref: "pi_9" };
  const eventsOf = (kind: string) => db.tables.zernio_logs!.filter((e) => e.event_type === kind);

  it("отклонённый заказ: markPaidOnline не трогает его и говорит «закрыт»", async () => {
    db.tables.orders![0]!.status = "rejected";
    expect(await markPaidOnline(ctx(), 7, 3000, "Stripe", "pi_9")).toMatchObject({
      ok: true,
      alreadyDone: true,
      closed: true,
      status: "rejected",
    });
    expect(db.tables.orders![0]!.status).toBe("rejected");
    expect(eventsOf("order.payment")).toHaveLength(0);
  });

  it("оплаченный заказ — не «закрыт»: это обычный повтор колбэка", async () => {
    await markPaidOnline(ctx(), 7, 3000, "Stripe", "pi_9");
    expect(await markPaidOnline(ctx(), 7, 3000, "Stripe", "pi_9")).toMatchObject({
      alreadyDone: true,
      closed: false,
    });
  });

  it("payment_on_closed: событие с суммой, валютой, шлюзом и номером платежа — один раз", async () => {
    expect(await recordUnappliedPayment(ctx(), 7, "payment_on_closed", details)).toBe(true);
    expect(await recordUnappliedPayment(ctx(), 7, "payment_on_closed", details)).toBe(false);
    const events = eventsOf("order.payment_on_closed");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      order_id: 7,
      amount: 3000,
      currency: "KZT",
      provider: "Stripe",
      invId: "pi_9",
    });
  });

  it("другой платёж по тому же заказу — отдельное событие", async () => {
    await recordUnappliedPayment(ctx(), 7, "payment_on_closed", details);
    expect(
      await recordUnappliedPayment(ctx(), 7, "payment_on_closed", { ...details, ref: "pi_10" }),
    ).toBe(true);
    expect(eventsOf("order.payment_on_closed")).toHaveLength(2);
  });

  it("payment_mismatch пишется так же", async () => {
    expect(
      await recordUnappliedPayment(ctx(), 7, "payment_mismatch", { ...details, amount: 100 }),
    ).toBe(true);
    expect(eventsOf("order.payment_mismatch")).toHaveLength(1);
  });

  it("повтор колбэка уже принятой оплаты, заказ потом вернули — тревоги нет", async () => {
    await markPaidOnline(ctx(), 7, 3000, "Stripe", "pi_9");
    db.tables.orders![0]!.status = "refunded";
    expect(await recordUnappliedPayment(ctx(), 7, "payment_on_closed", details)).toBe(false);
    expect(eventsOf("order.payment_on_closed")).toHaveLength(0);
  });
});
