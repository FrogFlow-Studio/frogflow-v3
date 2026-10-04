import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sendCartReminders } from "@/core/reminders/cart";
import { runWinback } from "@/core/winback/winback";
import { runFunnel } from "@/core/funnel/funnel";
import { runBirthdays } from "@/core/funnel/birthday";
import { runSimilar } from "@/core/similar/similar";

/**
 * Окно переключения v2 → v3: два крона могут сработать одновременно (старый
 * деплой ещё не остановлен, новый уже запущен). Каждая маркетинговая задача
 * при двух параллельных прогонах по одним данным шлёт покупателю одно
 * сообщение и ставит одну отметку (CLAUDE.md, «Один раз»).
 */
const DAY = 86_400_000;
// 11:00 в Алматы.
const NOW = new Date("2026-09-27T06:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

function base(modules: Record<string, boolean>) {
  const db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.app_settings = [];
  db.tables.blocked_users = [];
  const ctx = {
    tenant: { id: "bot", modules, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const buyer = (extra: Record<string, unknown> = {}) => ({
  user_key: "tg_1",
  telegram_id: 1,
  platform: "telegram",
  first_name: "Аня",
  opt_out: false,
  cart_reminder_sent_at: null,
  state: {},
  created_at: ago(3),
  ...extra,
});

const twice = <T>(run: () => Promise<T>) => Promise.all([run(), run()]);

describe("два крона одновременно: одно сообщение и одна отметка", () => {
  it("напоминание о корзине", async () => {
    const { db, ctx } = base({ cart_reminder: true });
    db.tables.cart_items = [
      {
        id: "c1",
        telegram_id: 1,
        quantity: 1,
        product_variant_id: null,
        created_at: ago(1),
        products: {
          id: "p1",
          name: "Торт",
          price: 5000,
          currency: "KZT",
          country_prices: {},
          is_active: true,
          stock_quantity: null,
          fulfillment_kind: "physical",
        },
        product_variants: null,
      },
    ];
    db.tables.bot_users = [buyer()];
    const send = vi.fn(async () => true);
    const [a, b] = await twice(() => sendCartReminders(ctx, send, NOW));
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    expect(db.tables.bot_users![0]!.cart_reminder_sent_at).toBe(NOW.toISOString());
  });

  it("возврат клиентов", async () => {
    const { db, ctx } = base({ winback: true });
    db.tables.app_settings = [
      { key: "winback", value: JSON.stringify({ enabled: true, days1: 30, promo: "BACK" }) },
    ];
    db.tables.orders = [
      { id: 10, telegram_id: 1, platform: "telegram", status: "delivered", created_at: ago(40) },
    ];
    db.tables.bot_users = [buyer()];
    const send = vi.fn(async () => true);
    const [a, b] = await twice(() => runWinback(ctx, send, NOW));
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    const state = db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(state.winback).toMatchObject({ order_id: 10, step: 1 });
    expect(state.marketing_times).toHaveLength(1);
  });

  it("автоворонка", async () => {
    const { db, ctx } = base({ funnel: true });
    db.tables.app_settings = [
      {
        key: "funnel",
        value: JSON.stringify({
          enabled: true,
          stopOnOrder: false,
          steps: [{ afterHours: 24, text: "{name}, заходите", catalogButton: true }],
        }),
      },
    ];
    db.tables.orders = [];
    db.tables.bot_users = [buyer()];
    const send = vi.fn(async () => true);
    const [a, b] = await twice(() => runFunnel(ctx, send, NOW));
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    const state = db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(state.funnel).toMatchObject({ step: 1 });
  });

  it("поздравление с днём рождения", async () => {
    const { db, ctx } = base({ funnel: true });
    db.tables.app_settings = [
      {
        key: "birthday_greeting",
        value: JSON.stringify({ enabled: true, text: "{name}, с днём рождения!", promo: "" }),
      },
    ];
    db.tables.bot_users = [buyer({ state: { birthday: "09-27" } })];
    const send = vi.fn(async () => true);
    const [a, b] = await twice(() => runBirthdays(ctx, send, NOW));
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    expect((db.tables.bot_users![0]!.state as Record<string, unknown>).birthday_sent).toBe(2026);
  });

  it("похожие материалы", async () => {
    const { db, ctx } = base({ winback: true });
    db.tables.app_settings = [
      {
        key: "similar_materials",
        value: JSON.stringify({ enabled: true, days: 7, text: "{name}, смотрите:" }),
      },
    ];
    const P = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
    const C = "c0000000-0000-4000-8000-00000000000a";
    db.tables.products = [1, 2, 3].map((n) => ({
      id: P(n),
      name: `Товар ${n}`,
      category_id: null,
      category_ids: [C],
      sort_order: n,
      stock_quantity: null,
      is_active: true,
    }));
    db.tables.categories = [{ id: C, parent_id: null, is_visible: true }];
    db.tables.bot_users = [buyer()];
    db.tables.orders = [
      { id: 10, telegram_id: 1, platform: "telegram", status: "delivered", created_at: ago(8) },
    ];
    db.tables.order_items = [{ order_id: 10, product_id: P(1) }];
    const send = vi.fn(async () => true);
    await twice(() => runSimilar(ctx, send, NOW));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
