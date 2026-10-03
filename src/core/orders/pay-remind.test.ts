import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { PayReminder } from "./pay-remind";

vi.mock("@/config/env", () => ({ env: () => ({}) }));
vi.mock("@/core/fulfillment/fulfillment", () => ({
  amountDueNow: async (_c: unknown, o: { total: number; fulfillment_kind: string }) =>
    o.fulfillment_kind === "physical" ? o.total / 2 : o.total,
}));

const { remindChatOrders, parsePayRemindHours, PAY_REMIND_KEY } = await import("./pay-remind");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const NOW = new Date("2026-09-27T12:00:00Z");
const H = 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function setup(orders: Array<Record<string, unknown>>, hours: string | null = "3") {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] }, maxRows: 1000 });
  db.tables.orders = orders.map((o, i) => ({
    id: 100 + i,
    bot_id: BOT,
    order_no: 1 + i,
    display_no: 501 + i,
    telegram_id: 42 + i,
    platform: "telegram",
    status: "awaiting_payment",
    payment_proof_path: null,
    total: 2500,
    currency: "KZT",
    fulfillment_kind: "digital",
    country_code: "KZ",
    created_at: ago(4 * H),
    ...o,
  }));
  db.tables.zernio_logs = [];
  db.tables.manager_chat_messages = [];
  db.tables.payment_methods = [
    {
      id: "pm1",
      bot_id: BOT,
      country_code: "KZ",
      is_active: true,
      sort_order: 0,
      instructions: "Kaspi 8 700 000 00 00",
    },
  ];
  db.tables.app_settings =
    hours === null ? [] : [{ bot_id: BOT, key: PAY_REMIND_KEY, value: hours }];
  const ctx = { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
  const sent: PayReminder[] = [];
  const send = vi.fn(async (r: PayReminder) => {
    sent.push(r);
    return true;
  });
  return { db, ctx, sent, send };
}

describe("напоминание об оплате в боте, Instagram и WhatsApp", () => {
  it("настройка: только часы из списка, остальное — выключено", () => {
    expect(parsePayRemindHours("3")).toBe(3);
    expect(parsePayRemindHours("12")).toBe(12);
    for (const v of [null, "", "0", "5", "24", "abc", "-1"])
      expect(parsePayRemindHours(v)).toBeNull();
  });

  it("по умолчанию выключено — ни одного сообщения", async () => {
    const { ctx, send } = setup([{}], null);
    expect(await remindChatOrders(ctx, send, NOW)).toEqual({ off: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("через N часов — одно сообщение с суммой и реквизитами; повторный прогон не пишет", async () => {
    const { db, ctx, sent, send } = setup([{}]);
    expect(await remindChatOrders(ctx, send, NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sent).toEqual([
      {
        orderId: 100,
        no: 501,
        platform: "telegram",
        telegramId: 42,
        due: 2500,
        total: 2500,
        currency: "KZT",
        instructions: "Kaspi 8 700 000 00 00",
        invoiceLink: false,
      },
    ]);
    expect(db.tables.zernio_logs).toEqual([
      expect.objectContaining({
        event_id: "order:100:reminded:chat",
        event_type: "order.reminded",
      }),
    ]);
    await remindChatOrders(ctx, send, NOW);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("два крона одновременно — одно сообщение и одна отметка в журнале", async () => {
    const { db, ctx, send } = setup([{}]);
    const r = await Promise.all([
      remindChatOrders(ctx, send, NOW),
      remindChatOrders(ctx, send, NOW),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.reduce((n, x) => n + ("sent" in x ? x.sent : 0), 0)).toBe(1);
    expect(db.tables.zernio_logs).toHaveLength(1);
  });

  it("физический заказ с задатком — к оплате задаток", async () => {
    const { ctx, sent, send } = setup([{ fulfillment_kind: "physical", total: 4000 }]);
    await remindChatOrders(ctx, send, NOW);
    expect(sent[0]).toMatchObject({ due: 2000, total: 4000 });
  });

  it("рано, поздно, с чеком, оплаченный, с сайта, ручной, без чата — не пишем", async () => {
    const { ctx, send } = setup([
      { created_at: ago(2 * H) },
      { created_at: ago(21 * H) },
      { payment_proof_path: "x/y.jpg" },
      { status: "awaiting_confirmation" },
      { platform: "web" },
      { platform: "manual" },
      { telegram_id: -5 },
    ]);
    expect(await remindChatOrders(ctx, send, NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("магазин без «Чата» (журнал пуст): Instagram/WhatsApp напоминаем, окно — от заказа", async () => {
    const { db, ctx, sent, send } = setup([
      { platform: "instagram", telegram_id: -100 },
      { platform: "whatsapp", telegram_id: -200, created_at: ago(19 * H) },
    ]);
    expect(db.tables.manager_chat_messages).toEqual([]);
    expect(await remindChatOrders(ctx, send, NOW)).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(sent.map((r) => r.platform)).toEqual(["whatsapp", "instagram"]);
  });

  it("счёт ссылкой из «Чата»: окно — по последнему входящему покупателя", async () => {
    const { db, ctx, sent, send } = setup([
      { platform: "instagram", telegram_id: -100 },
      { platform: "whatsapp", telegram_id: -200 },
    ]);
    db.tables.app_settings!.push(
      { bot_id: BOT, key: "invoice_link:100", value: "1" },
      { bot_id: BOT, key: "invoice_link:101", value: "1" },
    );
    db.tables.manager_chat_messages = [
      { id: "m1", bot_id: BOT, telegram_id: -100, direction: "in", created_at: ago(5 * H) },
      // Покупатель WhatsApp писал давно, после — только ответы магазина.
      { id: "m2", bot_id: BOT, telegram_id: -200, direction: "in", created_at: ago(30 * H) },
      { id: "m3", bot_id: BOT, telegram_id: -200, direction: "out", created_at: ago(1 * H) },
    ];
    expect(await remindChatOrders(ctx, send, NOW)).toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(sent.map((r) => r.platform)).toEqual(["instagram"]);
    // Пропущенный заказ не помечен: напишет покупатель — напомним.
    expect(db.tables.zernio_logs!.map((l) => l.event_id)).toEqual(["order:100:reminded:chat"]);
  });

  it("счёт ссылкой (#194): флаг ссылки, реквизитов нет", async () => {
    const { db, ctx, sent, send } = setup([{ platform: "instagram", telegram_id: -100 }]);
    db.tables.app_settings!.push({ bot_id: BOT, key: "invoice_link:100", value: "1" });
    db.tables.manager_chat_messages = [
      { id: "m1", bot_id: BOT, telegram_id: -100, direction: "in", created_at: ago(1 * H) },
    ];
    await remindChatOrders(ctx, send, NOW);
    expect(sent[0]).toMatchObject({ invoiceLink: true, instructions: null });
  });

  it("заказ оплачен после выборки — метка стоит, но сообщения нет", async () => {
    const { db, ctx, send } = setup([{}]);
    const origFrom = db.from.bind(db);
    let marked = false;
    db.from = ((t: string) => {
      if (t === "zernio_logs" && !marked) {
        marked = true;
        db.tables.orders![0]!.status = "awaiting_confirmation";
      }
      return origFrom(t);
    }) as typeof db.from;
    await remindChatOrders(ctx, send, NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it("сбой отправки считается, прогон не падает", async () => {
    const { ctx } = setup([{}, {}]);
    const send = vi.fn().mockRejectedValueOnce(new Error("сеть")).mockResolvedValueOnce(false);
    expect(await remindChatOrders(ctx, send, NOW)).toEqual({ sent: 0, failed: 2, skipped: 0 });
  });

  it("нет способа оплаты для страны — реквизитов нет, сообщение всё равно уходит", async () => {
    const { ctx, sent, send } = setup([{ country_code: "UZ" }]);
    await remindChatOrders(ctx, send, NOW);
    expect(sent[0]!.instructions).toBeNull();
  });
});
