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

function setup(state: Record<string, unknown> = {}) {
  const db = fakeDb();
  db.tables.cart_items = [{ telegram_id: 42, created_at: hoursAgo(10) }];
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
