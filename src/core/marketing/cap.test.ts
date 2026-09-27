import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimMarketing, marketingAllowed, parseMarketingCap, recentMarketing } from "./cap";

const NOW = new Date("2026-09-27T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function setup(state: Record<string, unknown> = { mode: "idle" }) {
  const db = fakeDb();
  db.tables.bot_users = [{ id: "u1", user_key: "tg_1", telegram_id: 1, state }];
  const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
  return { ctx, db, row: db.tables.bot_users[0]! };
}

describe("потолок маркетинговых автосообщений", () => {
  it("настройка: пусто — одно в сутки, «0» — без потолка, больше предела — предел", () => {
    expect(parseMarketingCap(null)).toBe(1);
    expect(parseMarketingCap("")).toBe(1);
    expect(parseMarketingCap("abc")).toBe(1);
    expect(parseMarketingCap("0")).toBe(0);
    expect(parseMarketingCap("3")).toBe(3);
    expect(parseMarketingCap("99")).toBe(10);
  });

  it("считаются только сообщения за последние 24 часа", () => {
    const state = { last_marketing_at: ago(2), marketing_times: [ago(30), ago(2)] };
    expect(recentMarketing(state, NOW)).toEqual([ago(2)]);
    expect(marketingAllowed(state, 1, NOW)).toBe(false);
    expect(marketingAllowed(state, 2, NOW)).toBe(true);
    expect(marketingAllowed({ last_marketing_at: ago(25) }, 1, NOW)).toBe(true);
    expect(marketingAllowed(state, 0, NOW)).toBe(true);
  });

  it("захват ставит метку до отправки и не трогает остальное состояние", async () => {
    const { ctx, row } = setup({ mode: "idle", locale: "kk" });
    const next = await claimMarketing(ctx, "tg_1", row.state as never, 1, NOW);
    expect(next).toMatchObject({
      mode: "idle",
      locale: "kk",
      last_marketing_at: NOW.toISOString(),
    });
    expect(row.state).toEqual(next);
  });

  it("второй за сутки — отказ, пока потолок одно сообщение", async () => {
    const { ctx, row } = setup();
    const first = await claimMarketing(ctx, "tg_1", row.state as never, 1, NOW);
    expect(first).not.toBeNull();
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    expect(await claimMarketing(ctx, "tg_1", row.state as never, 1, later)).toBeNull();
    const nextDay = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(await claimMarketing(ctx, "tg_1", row.state as never, 1, nextDay)).not.toBeNull();
  });

  it("два крона с одним прочитанным состоянием — место получает один", async () => {
    const { ctx, row } = setup();
    const seen = { ...(row.state as object) } as never;
    const [a, b] = await Promise.all([
      claimMarketing(ctx, "tg_1", seen, 1, NOW),
      claimMarketing(ctx, "tg_1", seen, 1, new Date(NOW.getTime() + 1000)),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("диалог успел записать state — метку не ставим поверх его изменений", async () => {
    const { ctx, row } = setup({ mode: "idle" });
    const seen = row.state as never;
    row.state = { mode: "awaiting_phone" };
    expect(await claimMarketing(ctx, "tg_1", seen, 1, NOW)).toBeNull();
    expect(row.state).toEqual({ mode: "awaiting_phone" });
  });

  it("потолок «0» — метку не пишем, отправлять можно всегда", async () => {
    const { ctx, row } = setup();
    expect(await claimMarketing(ctx, "tg_1", row.state as never, 0, NOW)).toEqual(row.state);
    expect(row.state).toEqual({ mode: "idle" });
  });

  it("условие записи — метка и шаг диалога, а не весь state (431 на длинном state)", async () => {
    const { ctx, db, row } = setup({ mode: "idle", history: "я".repeat(20_000) });
    const from = db.from.bind(db);
    const eqs: string[] = [];
    (db as { from: typeof db.from }).from = ((t: string) => {
      const q = from(t);
      const eq = q.eq.bind(q);
      (q as { eq: typeof q.eq }).eq = ((c: string, v: unknown) => {
        eqs.push(c);
        return eq(c, v);
      }) as typeof q.eq;
      return q;
    }) as typeof db.from;
    expect(await claimMarketing(ctx, "tg_1", row.state as never, 1, NOW)).not.toBeNull();
    expect(eqs).not.toContain("state");
    expect(eqs).toContain("state->>mode");
  });

  it("сбой записи (например, 431) — места нет, причина в логе", async () => {
    const { ctx, db, row } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    (db as { from: unknown }).from = () => ({
      update: () => {
        const q = {
          eq: () => q,
          is: () => q,
          select: async () => ({
            data: null,
            error: { message: "431 Request Header Fields Too Large" },
          }),
        };
        return q;
      },
    });
    expect(await claimMarketing(ctx, "tg_1", row.state as never, 1, NOW)).toBeNull();
    expect(log.mock.calls[0]![0]).toContain("431");
    log.mockRestore();
  });
});
