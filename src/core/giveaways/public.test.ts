import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { createGiveaway, closeGiveaway } = await import("./giveaway");
const { recordEntry } = await import("./entry");
const { drawWinners } = await import("./draw");
const { maskName, publicGiveaway } = await import("./public");

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const LATER = new Date("2026-10-12T10:00:00.000Z");

function setup() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  const ctx = {
    tenant: { id: BOT, modules: {}, ownerTelegramId: null, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}
const form = {
  title: "Осень",
  prize: "Открытки",
  channel: "telegram" as const,
  conditions: "Нажмите кнопку",
  endsAt: "2026-10-11T10:00:00.000Z",
  winners: 1,
  subscribeChannel: "",
  excludeBlocked: true,
  excludeStaff: true,
};

describe("маска имени", () => {
  it("две буквы и звёздочки, @ не считается, пустое — только звёздочки", () => {
    expect(maskName("Айгерим")).toBe("Ай***");
    expect(maskName("@anna_k")).toBe("an***");
    expect(maskName("Я")).toBe("Я***");
    expect(maskName(null)).toBe("***");
    expect(maskName("😀😀😀")).toBe("😀😀***");
  });
});

describe("публичный вид розыгрыша", () => {
  it("до итогов: число участников, без зерна и хеша", async () => {
    const { ctx } = setup();
    const g = await createGiveaway(ctx, form, NOW);
    for (const i of [1, 2, 3])
      await recordEntry(ctx, g, { userKey: `tg_${i}`, telegramId: i, channel: "telegram" }, NOW);
    const other = await createGiveaway(ctx, form, NOW);
    await recordEntry(ctx, other, { userKey: "tg_9", telegramId: 9, channel: "telegram" }, NOW);
    const v = await publicGiveaway(ctx, g.id);
    expect(v).toMatchObject({ title: "Осень", entered: 3, status: "open", result: null });
    expect(JSON.stringify(v)).not.toContain("seed");
  });

  it("после итогов: победитель только маской, имя и ключ наружу не уходят", async () => {
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form, NOW);
    await recordEntry(ctx, g, { userKey: "tg_1", telegramId: 1, channel: "telegram" }, NOW);
    db.tables.bot_users = [
      {
        bot_id: BOT,
        user_key: "tg_1",
        telegram_id: 1,
        platform: "telegram",
        first_name: "Айгерим",
      },
    ];
    await closeGiveaway(ctx, g.id, NOW);
    const drawn = await drawWinners(ctx, g.id, null, LATER);
    const v = await publicGiveaway(ctx, g.id);
    expect(v?.result).toMatchObject({
      seed: drawn.result.seed,
      listHash: drawn.result.listHash,
      eligible: 1,
      winners: ["Ай***"],
    });
    const json = JSON.stringify(v);
    expect(json).not.toContain("Айгерим");
    expect(json).not.toContain("tg_1");
  });

  it("нет такого розыгрыша — null", async () => {
    const { ctx } = setup();
    expect(await publicGiveaway(ctx, "abcdefgh")).toBeNull();
    expect(await publicGiveaway(ctx, "../x")).toBeNull();
  });
});
