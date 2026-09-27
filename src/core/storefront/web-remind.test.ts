import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Mailer } from "@/core/mail/mail.server";

vi.mock("@/config/env", () => ({ env: () => ({}) }));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_c: unknown, o: { total: number }) => o.total,
}));

const { remindWebOrders, WEB_REMIND_AFTER_MS, WEB_REMIND_UNTIL_MS } = await import("./web-remind");
const { orderAccessToken } = await import("./web-order");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const SECRET = "test-secret-test-secret-test-secret-42";
const NOW = new Date("2026-09-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3600_000;

function setup(orders: Array<Record<string, unknown>>) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] }, maxRows: 1000 });
  db.tables.orders = orders.map((o, i) => ({
    id: 100 + i,
    bot_id: BOT,
    order_no: 1 + i,
    display_no: 501 + i,
    platform: "web",
    status: "awaiting_payment",
    payment_proof_path: null,
    total: 2500,
    currency: "KZT",
    fulfillment_kind: "digital",
    customer_email: "anna@mail.ru",
    created_at: ago(4 * H),
    ...o,
  }));
  db.tables.zernio_logs = [];
  db.tables.app_settings = [
    { bot_id: BOT, key: "shop_name", value: "Прописи" },
    { bot_id: BOT, key: "storefront_checkout", value: JSON.stringify({ enabled: true }) },
  ];
  const ctx = {
    tenant: { id: BOT, name: "bot", modules: {}, settings: { slug: "propisi" } },
    appUrl: "https://shop.test",
    db,
  } as unknown as TenantContext;
  const sent: Array<Parameters<Mailer>[0]> = [];
  const mailer: Mailer = vi.fn(async (m) => {
    sent.push(m);
    return { ok: true };
  });
  return { db, ctx, sent, mailer };
}

describe("письмо о неоплаченном заказе с сайта", () => {
  it("через 3 часа — одно письмо со ссылкой на страницу заказа; повторный запуск не пишет снова", async () => {
    const { db, ctx, sent, mailer } = setup([{}]);
    expect(await remindWebOrders(ctx, SECRET, NOW, mailer)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("anna@mail.ru");
    expect(sent[0]!.subject).toContain("№501");
    const url = `https://shop.test/s/propisi/order/100?t=${orderAccessToken(SECRET, BOT, 100)}`;
    expect(sent[0]!.text).toContain(url);
    expect(sent[0]!.text).toContain("Прописи");
    // До отмены через сутки осталось 20 часов.
    expect(sent[0]!.text).toContain("20 ч");
    expect(db.tables.zernio_logs).toEqual([
      expect.objectContaining({
        event_id: "order:100:reminded:email",
        event_type: "order.reminded",
        payload: expect.objectContaining({ order_id: 100, channel: "email" }),
      }),
    ]);
    expect(await remindWebOrders(ctx, SECRET, new Date(NOW.getTime() + H), mailer)).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(sent).toHaveLength(1);
  });

  it("два запуска крона одновременно — всё равно одно письмо", async () => {
    const { ctx, sent, mailer } = setup([{}]);
    await Promise.all([
      remindWebOrders(ctx, SECRET, NOW, mailer),
      remindWebOrders(ctx, SECRET, NOW, mailer),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("не пишет: рано, поздно, есть чек, оплачен, из бота, без почты", async () => {
    const { sent, ctx, mailer } = setup([
      { created_at: ago(WEB_REMIND_AFTER_MS - 60_000) },
      { created_at: ago(WEB_REMIND_UNTIL_MS + 60_000) },
      { payment_proof_path: "proofs/1.jpg" },
      { status: "delivered" },
      { platform: "telegram" },
      { customer_email: null },
      { customer_email: "  " },
    ]);
    expect(await remindWebOrders(ctx, SECRET, NOW, mailer)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("письмо не ушло — продавец видит это в заказе, повторно не пишем", async () => {
    const { db, ctx } = setup([{}]);
    const failing: Mailer = vi.fn(async () => ({ ok: false, error: "535 auth" }));
    expect(await remindWebOrders(ctx, SECRET, NOW, failing)).toEqual({ sent: 0, failed: 1 });
    expect(db.tables.zernio_logs!.map((r) => r.event_type).sort()).toEqual([
      "order.email_failed",
      "order.reminded",
    ]);
    await remindWebOrders(ctx, SECRET, NOW, failing);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("почта платформы не настроена — тихо пропускаем и ничего не отмечаем", async () => {
    const { db, ctx } = setup([{}]);
    expect(await remindWebOrders(ctx, SECRET, NOW)).toEqual({ sent: 0, failed: 0 });
    expect(db.tables.zernio_logs).toHaveLength(0);
  });

  it("у магазина нет адреса витрины — ссылку не собрать, не пишем", async () => {
    const { ctx, sent, mailer } = setup([{}]);
    (ctx.tenant.settings as { slug?: string }).slug = undefined;
    await remindWebOrders(ctx, SECRET, NOW, mailer);
    expect(sent).toHaveLength(0);
  });

  it("покупатель оплатил, пока крон шёл по списку, — письмо «не оплачен» не уходит", async () => {
    const { db, ctx } = setup([{}, {}]);
    const sent: string[] = [];
    // Пока уходит первое письмо, второй заказ оплачивают картой.
    const mailer: Mailer = vi.fn(async (m) => {
      sent.push(m.subject);
      db.tables.orders![1]!.status = "delivered";
      return { ok: true };
    });
    expect(await remindWebOrders(ctx, SECRET, NOW, mailer)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual([expect.stringContaining("№501")]);
  });

  it("неоплаченных в окне больше, чем влезает в страницу, — письмо получает каждый", async () => {
    const orders = Array.from({ length: 1234 }, (_, i) => ({
      customer_email: `b${i}@mail.ru`,
      created_at: ago(4 * H + (i % 7) * 60_000),
    }));
    const { ctx, sent, mailer } = setup(orders);
    expect(await remindWebOrders(ctx, SECRET, NOW, mailer)).toEqual({ sent: 1234, failed: 0 });
    expect(new Set(sent.map((m) => m.to)).size).toBe(1234);
  });

  it("продавец выключил оформление на сайте — страница заказа закрыта, не пишем", async () => {
    const { db, ctx, sent, mailer } = setup([{}]);
    db.tables.app_settings![1]!.value = JSON.stringify({ enabled: false });
    expect(await remindWebOrders(ctx, SECRET, NOW, mailer)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});
