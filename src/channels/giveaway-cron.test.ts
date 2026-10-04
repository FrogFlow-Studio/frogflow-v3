import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const AFTER = new Date("2026-10-12T10:00:00.000Z");

let ctx: TenantContext;
const sent: Array<{ chat: number; text: string }> = [];
const seller: string[] = [];

vi.mock("@/core/tenant/resolve.server", () => ({ tenantContext: () => ctx }));
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => ({
    call: async (method: string, p: { chat_id: number; text: string }) => {
      await Promise.resolve();
      if (method === "sendMessage") sent.push({ chat: p.chat_id, text: p.text });
      return { ok: true, result: {} };
    },
  }),
  notifyAdminsHtml: async (_c: unknown, html: string) => {
    seller.push(html);
    return 1;
  },
}));

const { createGiveaway, getGiveaway } = await import("@/core/giveaways/giveaway");
const { recordEntry } = await import("@/core/giveaways/entry");
const { runGiveawaysFor } = await import("./giveaway-cron.server");

function tenant(servedBy: string | null = "v2") {
  return {
    id: BOT,
    modules: { giveaways: true, blocked: true },
    settings: { ...(servedBy ? { served_by: servedBy } : {}), default_locale: "ru" },
  } as never;
}

async function seed(opts: { n?: number; winners?: number } = {}) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]], promo_codes: [["code"]] } });
  ctx = {
    tenant: {
      id: BOT,
      modules: { giveaways: true, blocked: true },
      ownerTelegramId: null,
      settings: { default_locale: "ru" },
    },
    db,
  } as unknown as TenantContext;
  const g = await createGiveaway(
    ctx,
    {
      title: "Осень",
      prize: "Открытки",
      channel: "telegram",
      conditions: "",
      endsAt: "2026-10-11T10:00:00.000Z",
      winners: opts.winners ?? 1,
      subscribeChannel: "",
      excludeBlocked: true,
      excludeStaff: true,
      prizePromoPercent: 10,
    },
    NOW,
  );
  for (let i = 1; i <= (opts.n ?? 3); i++) {
    db.tables.bot_users = [
      ...(db.tables.bot_users ?? []),
      { bot_id: BOT, user_key: `u_${i}`, telegram_id: i, platform: "telegram", state: {} },
    ];
    await recordEntry(ctx, g, { userKey: `u_${i}`, telegramId: i, channel: "telegram" }, NOW);
  }
  return { db, g };
}

beforeEach(() => {
  sent.length = 0;
  seller.length = 0;
});

describe("крон giveaways", () => {
  it("клиент v1 и клиент без served_by пропускаются, ничего не меняется", async () => {
    const { g } = await seed();
    for (const s of ["v1", null]) {
      expect(await runGiveawaysFor(tenant(s), { now: () => AFTER.getTime() })).toEqual({
        skipped: "not v2",
      });
    }
    expect((await getGiveaway(ctx, g.id))?.status).toBe("open");
    expect(sent).toHaveLength(0);
  });

  it("до срока ничего не происходит", async () => {
    const { g } = await seed();
    await runGiveawaysFor(tenant(), { now: () => NOW.getTime() + 3600_000 });
    expect((await getGiveaway(ctx, g.id))?.status).toBe("open");
  });

  it("по сроку: закрыл приём, выбрал, написал победителю, отчитался продавцу", async () => {
    const { g } = await seed();
    const r = await runGiveawaysFor(tenant(), { now: () => AFTER.getTime() });
    expect(r).toMatchObject({ closed: 1, drawn: 1, notified: 1, left: 0 });
    const after = await getGiveaway(ctx, g.id);
    expect(after?.status).toBe("drawn");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Вы победили");
    expect(seller).toHaveLength(1);
    expect(seller[0]).toContain("Победители");
    // Повторный прогон — ничего нового.
    await runGiveawaysFor(tenant(), { now: () => AFTER.getTime() + 60_000 });
    expect(sent).toHaveLength(1);
    expect(seller).toHaveLength(1);
  });

  it("два крона одновременно: один выбор, одно сообщение, один отчёт", async () => {
    const { g } = await seed({ n: 20 });
    const now = () => AFTER.getTime();
    const [a, b] = await Promise.all([
      runGiveawaysFor(tenant(), { now }),
      runGiveawaysFor(tenant(), { now }),
    ]);
    expect(Number("drawn" in a ? a.drawn : 0) + Number("drawn" in b ? b.drawn : 0)).toBe(1);
    const after = await getGiveaway(ctx, g.id);
    expect(after?.result?.winners).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chat).toBe(after!.result!.winners[0]!.telegramId);
    expect(seller).toHaveLength(1);
  });

  it("бюджет вышел: остаток помечен left, следующий прогон дошлёт сообщения", async () => {
    const { g } = await seed({ n: 5, winners: 3 });
    let t = AFTER.getTime();
    const r1 = await runGiveawaysFor(tenant(), { now: () => (t += 30_000), budgetMs: 100_000 });
    expect("left" in r1 && r1.left).toBeGreaterThan(0);
    const winners = (await getGiveaway(ctx, g.id))!.result!.winners;
    expect(sent.length).toBeLessThan(winners.length);
    const r2 = await runGiveawaysFor(tenant(), { now: () => AFTER.getTime() + 600_000 });
    expect(r2).toMatchObject({ left: 0 });
    expect(new Set(sent.map((s) => s.chat))).toEqual(new Set(winners.map((w) => w.telegramId)));
    expect(sent).toHaveLength(winners.length);
  });

  it("вручную закрытый раньше срока ждёт срока и не выбирается раньше", async () => {
    const { g } = await seed();
    const { closeGiveaway } = await import("@/core/giveaways/giveaway");
    await closeGiveaway(ctx, g.id, NOW);
    await runGiveawaysFor(tenant(), { now: () => NOW.getTime() + 3600_000 });
    expect((await getGiveaway(ctx, g.id))?.status).toBe("closed");
    await runGiveawaysFor(tenant(), { now: () => AFTER.getTime() });
    expect((await getGiveaway(ctx, g.id))?.status).toBe("drawn");
  });
});
