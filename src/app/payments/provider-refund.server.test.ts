import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";

/** Возврат от шлюза: запись в историю заказа и снятие доступа к каналу курса. */
const revoke = vi.fn(async () => ({ kicked: 1, failed: 0 }));
vi.mock("@/core/courses/channel.server", () => ({ revokeChannelsOnRefund: revoke }));
vi.mock("@/channels/telegram/courses", () => ({ telegramChannelInviter: () => ({}) }));
vi.mock("@/channels/telegram/api", () => ({ telegramApi: () => ({}) }));
vi.mock("@/config/env", () => ({ env: () => ({}) }));

const { applyProviderRefund } = await import("./provider-refund.server");

const payment = (invId: string, amount: number, provider = "NOWPayments") => ({
  event_id: `order:7:payment:${invId}`,
  event_type: "order.payment",
  status: "event",
  payload: { order_id: 7, amount, currency: "USD", source: "online", provider, invId },
});

function ctxWith(status: string, courses: boolean, withPayment = true) {
  const db = fakeDb();
  db.tables.zernio_logs = withPayment ? [{ id: 1, ...payment("555", 100) }] : [];
  db.tables.orders = [
    {
      id: 7,
      status,
      total: 100,
      paid_amount: 0,
      currency: "USD",
      fulfillment_kind: "digital",
      telegram_id: 42,
      points_used: 0,
      points_earned: 0,
      promo_code: null,
      updated_at: "2026-10-01T00:00:00Z",
    },
  ];
  const ctx = {
    tenant: { id: "b", modules: { courses }, telegramTokenEnc: "enc" },
    secrets: { telegramToken: () => "x" },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

describe("возврат от платёжного шлюза", () => {
  it("оплаченный курс: возврат записан с суммой и номером платежа, канал закрыт", async () => {
    revoke.mockClear();
    const { ctx, db } = ctxWith("delivered", true);
    expect(await applyProviderRefund(ctx, 7, "NOWPayments", "555")).toBe("refunded");
    expect(db.tables.orders![0]!.status).toBe("refunded");
    const ev = db.tables.zernio_logs!.find((r) => r.event_type === "order.refund")!;
    expect(ev.payload).toMatchObject({ amount: 100, full: true, actor: "NOWPayments" });
    expect(String((ev.payload as { reason: string }).reason)).toContain("платёж 555");
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("повторное уведомление ничего не делает", async () => {
    revoke.mockClear();
    const { ctx, db } = ctxWith("delivered", true);
    await applyProviderRefund(ctx, 7, "NOWPayments", "555");
    expect(await applyProviderRefund(ctx, 7, "NOWPayments", "555")).toBe("skipped");
    expect(db.tables.zernio_logs!.filter((r) => r.event_type === "order.refund")).toHaveLength(1);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("платежа в истории нет (недоплата, чужой платёж) — заказ не тронут, канал открыт", async () => {
    revoke.mockClear();
    const { ctx, db } = ctxWith("delivered", true, false);
    expect(await applyProviderRefund(ctx, 7, "NOWPayments", "999")).toBe("unmatched");
    // Платёж есть, но другой номер или другой шлюз — тоже не он.
    db.tables.zernio_logs!.push({ id: 2, ...payment("111", 100) });
    db.tables.zernio_logs!.push({ id: 3, ...payment("999", 100, "Robokassa") });
    expect(await applyProviderRefund(ctx, 7, "NOWPayments", "999")).toBe("unmatched");
    expect(db.tables.orders![0]!.status).toBe("delivered");
    expect(db.tables.zernio_logs!.some((r) => r.event_type === "order.refund")).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("платёж меньше заказа (задаток): возвращается его сумма, статус и канал остаются", async () => {
    revoke.mockClear();
    const { ctx, db } = ctxWith("accepted", true);
    db.tables.orders![0]!.fulfillment_kind = "physical";
    db.tables.orders![0]!.paid_amount = 100;
    db.tables.orders![0]!.total = 300;
    expect(await applyProviderRefund(ctx, 7, "NOWPayments", "555")).toBe("refunded");
    const ev = db.tables.zernio_logs!.find((r) => r.event_type === "order.refund")!;
    expect(ev.payload).toMatchObject({ amount: 100, full: true });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("ошибка чтения истории — сбой (500 для шлюза), а не «пропустить»", async () => {
    const { ctx } = ctxWith("delivered", true);
    const real = ctx.db as unknown as { from: (t: string) => unknown };
    // Любой запрос к журналу заказа отвечает ошибкой базы.
    const broken: unknown = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (ok: (v: unknown) => unknown) =>
                ok({ data: null, error: { message: "база недоступна" } })
            : () => broken,
      },
    );
    (ctx as unknown as { db: unknown }).db = {
      from: (t: string) => (t === "zernio_logs" ? broken : real.from(t)),
    };
    await expect(applyProviderRefund(ctx, 7, "NOWPayments", "555")).rejects.toThrow();
  });

  it("деньги не получены — пропуск; без модуля курсов канал не трогаем", async () => {
    revoke.mockClear();
    const unpaid = ctxWith("awaiting_payment", true);
    expect(await applyProviderRefund(unpaid.ctx, 7, "NOWPayments", "555")).toBe("skipped");
    const plain = ctxWith("delivered", false);
    expect(await applyProviderRefund(plain.ctx, 7, "NOWPayments", "555")).toBe("refunded");
    expect(revoke).not.toHaveBeenCalled();
  });
});
