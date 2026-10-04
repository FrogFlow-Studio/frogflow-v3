import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { createGiveaway, closeGiveaway, getGiveaway } = await import("./giveaway");
const { recordEntry } = await import("./entry");
const { drawWinners, rerollWinner, rankKeys, listHash, verifyDraw } = await import("./draw");

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const LATER = new Date("2026-10-12T10:00:00.000Z");

function setup(opts: { blocked?: number[]; ownerTelegramId?: number } = {}) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  for (const t of opts.blocked ?? [])
    db.tables.blocked_users = [...(db.tables.blocked_users ?? []), { bot_id: BOT, telegram_id: t }];
  const ctx = {
    tenant: {
      id: BOT,
      modules: { blocked: true },
      ownerTelegramId: opts.ownerTelegramId ?? null,
      settings: {},
    },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}
const form = (patch: Record<string, unknown> = {}) => ({
  title: "Осень",
  prize: "Открытки",
  channel: "telegram" as const,
  conditions: "",
  endsAt: "2026-10-11T10:00:00.000Z",
  winners: 2,
  subscribeChannel: "",
  excludeBlocked: true,
  excludeStaff: true,
  ...patch,
});
async function fill(ctx: TenantContext, n: number, patch: Record<string, unknown> = {}) {
  const g = await createGiveaway(ctx, form(patch), NOW);
  for (let i = 1; i <= n; i++)
    await recordEntry(ctx, g, { userKey: `tg_${i}`, telegramId: i, channel: "telegram" }, NOW);
  await closeGiveaway(ctx, g.id, NOW);
  return g;
}

describe("выбор победителей", () => {
  it("зерно и хеш воспроизводят выбор", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 20);
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    expect(result.winners).toHaveLength(2);
    const keys = Array.from({ length: 20 }, (_, i) => `tg_${i + 1}`);
    const v = verifyDraw(result, keys);
    expect(v.hashMatches).toBe(true);
    expect(v.winners).toEqual(result.winners.map((w) => w.userKey));
    expect(listHash([...keys].reverse())).toBe(result.listHash);
    expect(rankKeys("abc", keys)).toEqual(rankKeys("abc", [...keys].reverse()));
  });

  it("два одновременных «Выбрать» — одни победители, записан один итог", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 30);
    const [a, b] = await Promise.all([
      drawWinners(ctx, g.id, null, LATER),
      drawWinners(ctx, g.id, null, LATER),
    ]);
    expect(a.result.seed).toBe(b.result.seed);
    expect(a.result.winners).toEqual(b.result.winners);
    expect([a.fresh, b.fresh].filter(Boolean)).toHaveLength(1);
    const after = await getGiveaway(ctx, g.id);
    expect(after?.status).toBe("drawn");
    expect(after?.result?.seed).toBe(a.result.seed);
  });

  it("повтор после выбора не меняет победителей", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 30);
    const first = await drawWinners(ctx, g.id, null, LATER);
    const again = await drawWinners(ctx, g.id, null, LATER);
    expect(again.fresh).toBe(false);
    expect(again.result).toEqual(first.result);
  });

  it("заблокированные и сотрудники не выигрывают", async () => {
    const { ctx } = setup({ blocked: [1, 2, 3], ownerTelegramId: 4 });
    const g = await fill(ctx, 6, { winners: 10 });
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    expect(result.entered).toBe(6);
    expect(result.eligible).toBe(2);
    expect(result.winners.map((w) => w.userKey).sort()).toEqual(["tg_5", "tg_6"]);
  });

  it("исключения можно выключить", async () => {
    const { ctx } = setup({ blocked: [1] });
    const g = await fill(ctx, 3, { winners: 10, excludeBlocked: false });
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    expect(result.eligible).toBe(3);
  });

  it("отписавшиеся не выигрывают, а сбой проверки подписки не даёт выбрать вслепую", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 4, { winners: 10, subscribeChannel: "@my_channel" });
    await expect(drawWinners(ctx, g.id, async () => null, LATER)).rejects.toThrow();
    expect((await getGiveaway(ctx, g.id))?.status).toBe("closed");
    const { result } = await drawWinners(ctx, g.id, async (_c, id) => id % 2 === 0, LATER);
    expect(result.winners.map((w) => w.userKey).sort()).toEqual(["tg_2", "tg_4"]);
  });

  it("пока идёт приём, выбрать нельзя; по сроку можно без закрытия", async () => {
    const { ctx } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    await expect(drawWinners(ctx, g.id, null, NOW)).rejects.toThrow(/Приём ещё идёт/);
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    expect(result.winners).toEqual([]);
    expect(result.eligible).toBe(0);
  });

  it("страниц больше одной — участники не теряются", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 1005, { winners: 50 });
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    expect(result.entered).toBe(1005);
    expect(result.winners).toHaveLength(50);
  });
});

describe("перевыбор победителя", () => {
  it("заменяет следующим по зерну, причина остаётся в журнале", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 10);
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    const out = result.winners[0]!.userKey;
    const keys = Array.from({ length: 10 }, (_, i) => `tg_${i + 1}`);
    const { giveaway, replacement } = await rerollWinner(ctx, g.id, out, "не ответил", null, LATER);
    expect(replacement?.userKey).toBe(rankKeys(result.seed, keys)[2]);
    expect(giveaway.result?.winners.map((w) => w.userKey)).not.toContain(out);
    expect(giveaway.result?.rerolls).toEqual([
      { at: LATER.toISOString(), replaced: out, by: replacement?.userKey, reason: "не ответил" },
    ]);
    expect(giveaway.result?.seed).toBe(result.seed);
  });

  it("без причины и для не-победителя — отказ; второй такой же перевыбор — тоже", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 10);
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    const out = result.winners[0]!.userKey;
    await expect(rerollWinner(ctx, g.id, out, "  ", null, LATER)).rejects.toThrow(/причину/);
    await expect(rerollWinner(ctx, g.id, "tg_999", "причина", null, LATER)).rejects.toThrow(
      /уже заменили/,
    );
    const res = await Promise.allSettled([
      rerollWinner(ctx, g.id, out, "первый", null, LATER),
      rerollWinner(ctx, g.id, out, "второй", null, LATER),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getGiveaway(ctx, g.id))?.result?.rerolls).toHaveLength(1);
  });

  it("некем заменить — победитель снимается, запись в журнале", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 2);
    const { result } = await drawWinners(ctx, g.id, null, LATER);
    const { giveaway, replacement } = await rerollWinner(
      ctx,
      g.id,
      result.winners[0]!.userKey,
      "жульничал",
      null,
      LATER,
    );
    expect(replacement).toBeNull();
    expect(giveaway.result?.winners).toHaveLength(1);
    expect(giveaway.result?.rerolls[0]?.by).toBe("");
  });

  it("до выбора перевыбирать нечего", async () => {
    const { ctx } = setup();
    const g = await fill(ctx, 2);
    await expect(rerollWinner(ctx, g.id, "tg_1", "причина", null, LATER)).rejects.toThrow(
      /ещё не выбраны/,
    );
  });
});
