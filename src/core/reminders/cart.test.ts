import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Напоминание о корзине и общий потолок маркетинговых сообщений (core/marketing/cap). */
vi.mock("@/core/marketing/cap", async (orig) => {
  const real = await orig<typeof import("@/core/marketing/cap")>();
  return { ...real, claimMarketing: vi.fn(real.claimMarketing) };
});
const cap = await import("@/core/marketing/cap");
const { sendCartReminders } = await import("./cart");

const NOW = new Date("2026-09-27T12:00:00Z");
const hoursAgo = (h: number, from = NOW) => new Date(from.getTime() - h * 3_600_000).toISOString();

const product = (id: string, name: string, price: number, over: Record<string, unknown> = {}) => ({
  id,
  name,
  price,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  stock_quantity: null,
  fulfillment_kind: "physical",
  ...over,
});
const cartRow = (id: string, p: ReturnType<typeof product>, quantity = 1, telegramId = 42) => ({
  id,
  telegram_id: telegramId,
  quantity,
  product_variant_id: null,
  created_at: hoursAgo(10),
  products: p,
  product_variants: null,
});

function setup(state: Record<string, unknown> = {}) {
  const db = fakeDb();
  db.tables.cart_items = [cartRow("c1", product("p1", "Торт", 5000))];
  db.tables.bot_users = [
    {
      user_key: "tg_42",
      telegram_id: 42,
      platform: "telegram",
      opt_out: false,
      cart_reminder_sent_at: null,
      state,
    },
  ];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: "b", modules: { cart_reminder: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, row: db.tables.bot_users[0]! };
}

describe("напоминание о корзине под потолком", () => {
  it("место за сутки занято — корзину не отмечаем, напомним, когда освободится", async () => {
    const { ctx, row } = setup({ last_marketing_at: hoursAgo(2) });
    const send = vi.fn(async () => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(0);
    expect(row.cart_reminder_sent_at).toBeNull();

    const later = new Date(NOW.getTime() + 23 * 3_600_000);
    expect((await sendCartReminders(ctx, send, later)).sent).toBe(1);
    expect(row.cart_reminder_sent_at).toBe(later.toISOString());
  });

  it("место ушло после отметки корзины — отметка возвращается, напоминание не теряется", async () => {
    const { ctx, row } = setup();
    const send = vi.fn(async () => true);
    vi.mocked(cap.claimMarketing).mockResolvedValueOnce(null);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(0);
    expect(row.cart_reminder_sent_at).toBeNull();

    const later = new Date(NOW.getTime() + 30 * 60_000);
    expect((await sendCartReminders(ctx, send, later)).sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/** Адресат Direct/WhatsApp: корзина по синтетическому id, диалог Zernio, окно ответа 24 часа. */
function setupDirect(inboundHoursAgo: number | null) {
  const db = fakeDb();
  db.tables.cart_items = [cartRow("c1", product("p1", "Торт", 5000), 1, -77)];
  db.tables.bot_users = [
    {
      user_key: "ig_77",
      telegram_id: -77,
      platform: "instagram",
      opt_out: false,
      cart_reminder_sent_at: null,
      state: {},
      zernio_conversation_id: "conv1",
      zernio_account_id: "acc1",
    },
  ];
  db.tables.manager_chat_messages =
    inboundHoursAgo == null
      ? []
      : [
          {
            id: "m1",
            bot_id: "b",
            telegram_id: -77,
            direction: "in",
            created_at: hoursAgo(inboundHoursAgo),
          },
        ];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: "b", modules: { cart_reminder: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, row: db.tables.bot_users[0]! };
}

describe("напоминание о корзине: что в тексте", () => {
  it("называет до трёх позиций, «ещё N» и сумму по текущим ценам", async () => {
    const { ctx } = setup();
    ctx.db = ctx.db as never;
    const db = ctx.db as unknown as ReturnType<typeof fakeDb>;
    db.tables.cart_items = [
      cartRow("c1", product("p1", "Торт", 5000), 2),
      cartRow("c2", product("p2", "Эклер", 700)),
      cartRow("c3", product("p3", "Капкейк", 600)),
      cartRow("c4", product("p4", "Булочка", 300)),
    ];
    const send = vi.fn(async (_t: unknown) => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(1);
    const t = send.mock.calls[0]![0] as {
      lines: { name: string; quantity: number }[];
      more: number;
      total: { amount: number; currency: string };
    };
    expect(t.lines).toEqual([
      { name: "Торт", quantity: 2 },
      { name: "Эклер", quantity: 1 },
      { name: "Капкейк", quantity: 1 },
    ]);
    expect(t.more).toBe(1);
    expect(t.total).toEqual({ amount: 11600, currency: "KZT" });
  });

  it("недоступные позиции не упоминаются и не входят в сумму", async () => {
    const { ctx } = setup();
    const db = ctx.db as unknown as ReturnType<typeof fakeDb>;
    db.tables.cart_items = [
      cartRow("c1", product("p1", "Торт", 5000)),
      cartRow("c2", product("p2", "Снятый", 900, { is_active: false })),
      cartRow("c3", product("p3", "Закончился", 800, { stock_quantity: 0 })),
    ];
    const send = vi.fn(async (_t: unknown) => true);
    await sendCartReminders(ctx, send, NOW);
    const t = send.mock.calls[0]![0] as { lines: { name: string }[]; total: { amount: number } };
    expect(t.lines.map((l) => l.name)).toEqual(["Торт"]);
    expect(t.total.amount).toBe(5000);
  });

  it("вся корзина недоступна — напоминания нет и корзина не отмечена", async () => {
    const { ctx, row } = setup();
    const db = ctx.db as unknown as ReturnType<typeof fakeDb>;
    db.tables.cart_items = [cartRow("c1", product("p1", "Снятый", 900, { is_active: false }))];
    const send = vi.fn(async () => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(row.cart_reminder_sent_at).toBeNull();
  });
});

describe("напоминание о корзине: Instagram и WhatsApp", () => {
  it("вне окна 24 часа — тишина, корзина не отмечена", async () => {
    const { ctx, row } = setupDirect(30);
    const send = vi.fn(async () => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(row.cart_reminder_sent_at).toBeNull();
  });

  it("входящих нет вовсе — тишина", async () => {
    const { ctx } = setupDirect(null);
    const send = vi.fn(async () => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(0);
  });

  it("внутри окна — одно сообщение и отметка корзины", async () => {
    const { ctx, row } = setupDirect(3);
    const send = vi.fn(async (_t: unknown) => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as { customer: { platform: string } }).customer.platform).toBe(
      "instagram",
    );
    expect(row.cart_reminder_sent_at).toBe(NOW.toISOString());
    // Следующий прогон про ту же корзину молчит.
    expect((await sendCartReminders(ctx, send, new Date(NOW.getTime() + 3_600_000))).sent).toBe(0);
  });

  it("гонка двух кронов — одно сообщение", async () => {
    const { ctx } = setupDirect(3);
    const send = vi.fn(async () => true);
    const [a, b] = await Promise.all([
      sendCartReminders(ctx, send, NOW),
      sendCartReminders(ctx, send, NOW),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("у покупателя нет диалога Zernio — тишина", async () => {
    const { ctx, row } = setupDirect(3);
    row.zernio_conversation_id = null;
    const send = vi.fn(async () => true);
    expect((await sendCartReminders(ctx, send, NOW)).sent).toBe(0);
  });
});
