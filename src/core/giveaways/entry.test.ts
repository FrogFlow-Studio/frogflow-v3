import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { createGiveaway, closeGiveaway } = await import("./giveaway");
const { ENTRY_EVENT, entryEventId, enterFromTelegram, hasEntered } = await import("./entry");

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const WHO = { userKey: "tg_42", telegramId: 42 };

function setup(modules: Record<string, boolean> = {}) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  const ctx = { tenant: { id: BOT, modules }, db } as unknown as TenantContext;
  return { db, ctx };
}
const form = (patch: Record<string, unknown> = {}) => ({
  title: "Осень",
  prize: "Открытки",
  channel: "telegram" as const,
  conditions: "",
  endsAt: "2026-10-11T10:00:00.000Z",
  winners: 1,
  subscribeChannel: "",
  excludeBlocked: true,
  excludeStaff: true,
  ...patch,
});
const member = (v: boolean | null) => vi.fn(async () => v);
const entries = (db: ReturnType<typeof setup>["db"]) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === ENTRY_EVENT);

describe("участие в розыгрыше из Telegram", () => {
  it("первое участие записывает событие, повтор — «уже участвуете»", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    const first = await enterFromTelegram(ctx, g.id, WHO, member(true), NOW);
    expect(first.status).toBe("entered");
    expect(entries(db)).toHaveLength(1);
    expect(entries(db)[0]).toMatchObject({
      bot_id: BOT,
      event_id: entryEventId(g.id, WHO.userKey),
      status: "event",
      payload: { giveaway_id: g.id, user_key: WHO.userKey, telegram_id: 42, channel: "telegram" },
    });
    expect((await enterFromTelegram(ctx, g.id, WHO, member(true), NOW)).status).toBe("already");
    expect(entries(db)).toHaveLength(1);
  });

  it("два нажатия одновременно — один участник, второй получает «уже»", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    const res = await Promise.all([
      enterFromTelegram(ctx, g.id, WHO, member(true), NOW),
      enterFromTelegram(ctx, g.id, WHO, member(true), NOW),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual(["already", "entered"]);
    expect(entries(db)).toHaveLength(1);
  });

  it("разные люди — разные участники", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    await enterFromTelegram(ctx, g.id, WHO, member(true), NOW);
    await enterFromTelegram(ctx, g.id, { userKey: "tg_43", telegramId: 43 }, member(true), NOW);
    expect(entries(db)).toHaveLength(2);
  });

  it("закрытый и просроченный розыгрыш не принимает, но прежнее участие помнит", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    await enterFromTelegram(ctx, g.id, WHO, member(true), NOW);
    await closeGiveaway(ctx, g.id, NOW);
    const late = { userKey: "tg_50", telegramId: 50 };
    expect((await enterFromTelegram(ctx, g.id, late, member(true), NOW)).status).toBe("closed");
    expect((await enterFromTelegram(ctx, g.id, WHO, member(true), NOW)).status).toBe("already");
    const g2 = await createGiveaway(ctx, form(), NOW);
    const after = new Date("2026-10-12T00:00:00.000Z");
    expect((await enterFromTelegram(ctx, g2.id, late, member(true), after)).status).toBe("closed");
    expect(entries(db)).toHaveLength(1);
  });

  it("без подписки — отказ и не участник; после подписки — участник", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form({ subscribeChannel: "@my_shop" }), NOW);
    const no = member(false);
    const r = await enterFromTelegram(ctx, g.id, WHO, no, NOW);
    expect(r.status).toBe("needSubscription");
    expect(no).toHaveBeenCalledWith("@my_shop", 42);
    expect(entries(db)).toHaveLength(0);
    expect(await hasEntered(ctx, g.id, WHO.userKey)).toBe(false);
    expect((await enterFromTelegram(ctx, g.id, WHO, member(true), NOW)).status).toBe("entered");
    expect(entries(db)).toHaveLength(1);
  });

  it("Telegram не ответил на проверку подписки — не участник, не «нет подписки»", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form({ subscribeChannel: "@my_shop" }), NOW);
    expect((await enterFromTelegram(ctx, g.id, WHO, member(null), NOW)).status).toBe("checkFailed");
    expect(entries(db)).toHaveLength(0);
  });

  it("проверка подписки не вызывается, если условия нет", async () => {
    const { ctx } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    const check = member(false);
    expect((await enterFromTelegram(ctx, g.id, WHO, check, NOW)).status).toBe("entered");
    expect(check).not.toHaveBeenCalled();
  });

  it("заблокированный продавцом не участвует", async () => {
    const { ctx, db } = setup({ blocked: true });
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 42 }];
    const g = await createGiveaway(ctx, form(), NOW);
    expect((await enterFromTelegram(ctx, g.id, WHO, member(true), NOW)).status).toBe("blocked");
    expect(entries(db)).toHaveLength(0);
  });

  it("розыгрыш только для Instagram и несуществующий в Telegram не найдены", async () => {
    const { ctx } = setup();
    const ig = await createGiveaway(ctx, form({ channel: "instagram" }), NOW);
    expect((await enterFromTelegram(ctx, ig.id, WHO, member(true), NOW)).status).toBe("notFound");
    expect((await enterFromTelegram(ctx, "abcdefgh", WHO, member(true), NOW)).status).toBe(
      "notFound",
    );
  });
});
