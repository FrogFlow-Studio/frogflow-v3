import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { notifyPreorderMoved } from "@/core/preorder/reschedule";
import { notifyWaitlist } from "@/core/waitlist/waitlist";
import { REQUEST_BUDGET_MS, requestBudget } from "./budget";

const BOT = "00000000-0000-0000-0000-000000000001";
const PRODUCT = "p-1";

describe("общий бюджет запроса", () => {
  it("остаток убывает с часами и не уходит ниже нуля", () => {
    let t = 0;
    const b = requestBudget(1000, () => t);
    expect(b.left()).toBe(1000);
    t = 400;
    expect(b.left()).toBe(600);
    t = 5000;
    expect(b.left()).toBe(0);
    expect(REQUEST_BUDGET_MS).toBeLessThan(120_000);
  });

  it("перенос предзаказа и лист ожидания вместе не дольше общего бюджета, остаток виден в итоге", async () => {
    let t = 0;
    const clock = () => t;
    const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
    db.tables.zernio_logs = [];
    db.tables.app_settings = [];
    db.tables.manager_chat_messages = [];
    // 10 заказов на предзаказ и 10 покупателей в листе ожидания; каждая отправка — 10 с.
    db.tables.orders = [];
    for (let id = 1; id <= 10; id++) {
      db.tables.zernio_logs.push({
        id: `ev-${id}`,
        bot_id: BOT,
        event_id: `order:${id}:preorder:x`,
        event_type: "order.preorder",
        status: "event",
        payload: {
          order_id: id,
          lines: [{ product_id: PRODUCT, quantity: 1, from: "2026-10-20" }],
        },
      });
      db.tables.orders.push({
        id,
        bot_id: BOT,
        display_no: id,
        order_no: id,
        platform: "telegram",
        status: "accepted",
        telegram_id: id,
        user_key: null,
      });
    }
    db.tables.bot_users = Array.from({ length: 10 }, (_, i) => ({
      user_key: `tg_${100 + i}`,
      telegram_id: 100 + i,
      platform: "telegram",
      state: { waitlist: [PRODUCT] },
    }));
    const ctx = {
      tenant: { id: BOT, modules: { waitlist: true }, settings: {} },
      db,
    } as unknown as TenantContext;
    const slow = vi.fn(async () => {
      t += 10_000;
      return true;
    });

    const budget = requestBudget(100_000, clock);
    const move = await notifyPreorderMoved(
      ctx,
      { productId: PRODUCT, name: "Торт", from: "2026-10-20", to: "2026-11-05" },
      slow,
      { now: clock, budgetMs: 60_000 },
    );
    const list = await notifyWaitlist(ctx, PRODUCT, slow, {
      now: clock,
      budgetMs: budget.left(),
    });
    expect(move.notified + list.notified).toBeLessThanOrEqual(10);
    expect(t).toBeLessThanOrEqual(100_000);
    expect(list.left).toBeGreaterThan(0);
  });
});
