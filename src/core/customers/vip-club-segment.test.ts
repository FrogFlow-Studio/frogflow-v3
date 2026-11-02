import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { presetSegments, segmentMembers, vipStatusOf } from "./saved-segments";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = Date.parse("2026-11-02T00:00:00Z");
const FUTURE = "2026-12-01T00:00:00Z";
const PAST = "2026-10-01T00:00:00Z";

function setup(vip = true) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.orders = [];
  db.tables.bot_users = [
    {
      bot_id: BOT,
      user_key: "tg:10",
      platform: "telegram",
      telegram_id: 10,
      first_name: "Анна",
      username: "anna",
      loyalty_points: 5,
    },
  ];
  db.tables.vip_subscriptions = [
    {
      id: "a",
      bot_id: BOT,
      telegram_id: 10,
      first_name: "Анна",
      status: "active",
      expires_at: FUTURE,
    },
    {
      id: "b",
      bot_id: BOT,
      telegram_id: 20,
      first_name: "Борис",
      status: "expired",
      expires_at: PAST,
    },
    // «active», но срок прошёл (крон ещё не перевёл) — уже не в клубе.
    {
      id: "c",
      bot_id: BOT,
      telegram_id: 30,
      first_name: "Вера",
      status: "active",
      expires_at: PAST,
    },
    {
      id: "d",
      bot_id: BOT,
      telegram_id: 40,
      first_name: "Глеб",
      status: "pending_payment",
      expires_at: FUTURE,
    },
  ];
  // Выбрала язык в VIP-боте и больше ничего.
  db.tables.vip_member_profiles = [
    { bot_id: BOT, telegram_id: 50, first_name: "Дина", username: "dina" },
    { bot_id: BOT, telegram_id: 10, first_name: "Анна", username: "anna" },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { vip } },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

describe("сегмент «VIP-клуб»", () => {
  it("участники, бывшие и писавшие VIP-боту — каждый со статусом, нынешние первыми", async () => {
    const { ctx } = setup();
    const r = await segmentMembers(ctx, { kind: "vip_club" }, NOW);
    expect(r.total).toBe(5);
    expect(r.members.map((m) => [m.name, m.vip])).toEqual([
      ["Анна", "active"],
      ["Борис", "former"],
      ["Вера", "former"],
      ["Глеб", "wrote"],
      ["Дина", "wrote"],
    ]);
  });

  it("кто есть в покупателях — со ссылкой на карточку, кто только в VIP-боте — без", async () => {
    const { ctx } = setup();
    const r = await segmentMembers(ctx, { kind: "vip_club" }, NOW);
    expect(r.members.find((m) => m.name === "Анна")).toMatchObject({ userKey: "tg:10", points: 5 });
    expect(r.members.find((m) => m.name === "Дина")).toMatchObject({
      userKey: null,
      username: "dina",
    });
  });

  it("подписок больше одной страницы — считаются все", async () => {
    const { ctx, db } = setup();
    db.tables.vip_subscriptions = Array.from({ length: 2300 }, (_, i) => ({
      id: `s${String(i).padStart(5, "0")}`,
      bot_id: BOT,
      telegram_id: 1000 + i,
      status: "expired",
      expires_at: PAST,
    }));
    db.tables.vip_member_profiles = [];
    const r = await segmentMembers(ctx, { kind: "vip_club" }, NOW);
    expect(r.total).toBe(2300);
    expect(r.members).toHaveLength(50);
  });

  it("без модуля VIP сегмента нет и он пуст", async () => {
    const { ctx } = setup(false);
    expect(presetSegments(ctx).map((s) => s.id)).not.toContain("preset:vip_club");
    expect(await segmentMembers(ctx, { kind: "vip_club" }, NOW)).toEqual({ total: 0, members: [] });
    const { ctx: withVip } = setup(true);
    expect(presetSegments(withVip).map((s) => s.id)).toContain("preset:vip_club");
  });

  it("статус: истёкшая оплаченная — «был», отклонённая или ждущая оплаты заявка — «писал»", () => {
    expect(vipStatusOf([{ status: "expired", expires_at: PAST }], NOW)).toBe("former");
    expect(vipStatusOf([{ status: "cancelled", expires_at: PAST }], NOW)).toBe("wrote");
    expect(vipStatusOf([{ status: "pending_payment", expires_at: FUTURE }], NOW)).toBe("wrote");
    expect(vipStatusOf([], NOW)).toBe("wrote");
  });
});
