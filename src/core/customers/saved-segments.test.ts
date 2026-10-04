import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { customerReferrals, customerReviews } from "./card-extra";
import {
  deleteSegment,
  listSegments,
  MAX_SEGMENTS,
  parseRule,
  parseSegments,
  purchaseStats,
  ruleKeys,
  saveSegment,
  segmentMembers,
  SEGMENT_PAGE,
} from "./saved-segments";

const ctx = (db: FakeDb) =>
  ({ tenant: { id: "b", modules: {}, settings: {} }, db }) as unknown as TenantContext;
const DAY = 86400_000;
const NOW = Date.parse("2026-10-04T10:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function user(n: number, over: Record<string, unknown> = {}) {
  return {
    user_key: `tg_${n}`,
    telegram_id: n,
    platform: "telegram",
    username: null,
    first_name: `Покупатель ${n}`,
    last_name: null,
    loyalty_points: 10 * n,
    opt_out: false,
    created_at: ago(100),
    ...over,
  };
}
function order(id: number, tg: number, daysAgo: number, status = "delivered") {
  return {
    id,
    bot_id: "b",
    telegram_id: tg,
    user_key: `tg_${tg}`,
    status,
    created_at: ago(daysAgo),
  };
}

describe("сегменты покупателей: правила", () => {
  it("мусор вместо правила — null, границы соблюдаются", () => {
    expect(parseRule({ kind: "orders_min", min: 2 })).toEqual({ kind: "orders_min", min: 2 });
    expect(parseRule({ kind: "orders_min", min: 0 })).toBeNull();
    expect(parseRule({ kind: "inactive", days: 60.7 })).toEqual({ kind: "inactive", days: 60 });
    expect(parseRule({ kind: "inactive", days: 99999 })).toBeNull();
    expect(parseRule({ kind: "tag", tag: "  VIP  " })).toEqual({ kind: "tag", tag: "VIP" });
    expect(parseRule({ kind: "tag", tag: " " })).toBeNull();
    expect(parseRule({ kind: "hack" })).toBeNull();
    expect(parseRule(null)).toBeNull();
  });

  it("испорченный список не роняет чтение: хорошие записи остаются", () => {
    const raw = JSON.stringify([
      { id: "a", name: "Ок", rule: { kind: "tag", tag: "x" } },
      { id: "b", name: "", rule: { kind: "tag", tag: "x" } },
      { id: "c", name: "Без правила" },
      "строка",
    ]);
    expect(parseSegments(raw)).toEqual([{ id: "a", name: "Ок", rule: { kind: "tag", tag: "x" } }]);
    expect(parseSegments("{не json")).toEqual([]);
    expect(parseSegments(null)).toEqual([]);
  });

  it("«купили 2+ раза» и «не покупали 60 дней» считаются по покупкам", () => {
    const stats = purchaseStats([
      { user_key: "tg_1", telegram_id: 1, created_at: ago(100) },
      { user_key: "tg_1", telegram_id: 1, created_at: ago(70) },
      { user_key: "tg_2", telegram_id: 2, created_at: ago(5) },
      { user_key: null, telegram_id: 3, created_at: ago(90) },
    ]);
    expect(ruleKeys({ kind: "orders_min", min: 2 }, stats, NOW)).toEqual(["tg_1"]);
    expect(ruleKeys({ kind: "inactive", days: 60 }, stats, NOW).sort()).toEqual(["tg_1", "tg_3"]);
    // Ровно на границе — ещё не «не покупал».
    expect(ruleKeys({ kind: "inactive", days: 5 }, stats, NOW)).not.toContain("tg_2");
  });
});

describe("сегмент считается постранично и без записи", () => {
  it("1500 покупок и 1200 покупателей: никто не теряется, баллы не меняются", async () => {
    const db = fakeDb({ maxRows: 1000, maxIn: 200 });
    db.tables.bot_users = Array.from({ length: 1200 }, (_, i) => user(i + 1));
    // Каждый купил дважды (2400 заказов, больше предела ответа 1000).
    db.tables.orders = Array.from({ length: 2400 }, (_, i) =>
      order(i + 1, (i % 1200) + 1, 10 + (i % 7)),
    );
    db.tables.orders.push(order(9001, 5, 1, "cancelled"));
    const before = JSON.stringify(db.tables.bot_users);
    const r = await segmentMembers(ctx(db), { kind: "orders_min", min: 2 }, NOW);
    expect(r.total).toBe(1200);
    expect(r.members).toHaveLength(SEGMENT_PAGE);
    expect(r.members.map((m) => m.userKey)).toEqual([...r.members.map((m) => m.userKey)].sort());
    expect(r.members[0]!.orders).toBe(2);
    expect(JSON.stringify(db.tables.bot_users)).toBe(before);
  });

  it("покупателя, которого нет в базе, в сегменте нет; отписавшийся помечен", async () => {
    const db = fakeDb();
    db.tables.bot_users = [user(1, { opt_out: true })];
    db.tables.orders = [order(1, 1, 80), order(2, 2, 80)];
    const r = await segmentMembers(ctx(db), { kind: "inactive", days: 60 }, NOW);
    expect(r.total).toBe(1);
    expect(r.members[0]).toMatchObject({ userKey: "tg_1", optOut: true });
  });

  it("сегмент «VIP» — по тегу продавца без учёта регистра", async () => {
    const db = fakeDb();
    db.tables.bot_users = [user(1), user(2), user(3)];
    db.tables.app_settings = [
      {
        bot_id: "b",
        key: "customer_note:tg_1",
        value: JSON.stringify({ tags: ["vip"], note: "" }),
        updated_at: ago(1),
      },
      {
        bot_id: "b",
        key: "customer_note:tg_2",
        value: JSON.stringify({ tags: ["другой"], note: "" }),
        updated_at: ago(1),
      },
    ];
    const r = await segmentMembers(ctx(db), { kind: "tag", tag: "VIP" }, NOW);
    expect(r.members.map((m) => m.userKey)).toEqual(["tg_1"]);
  });

  it("сбой чтения заказов — ошибка, а не пустой сегмент", async () => {
    const db = fakeDb();
    db.tables.bot_users = [user(1)];
    const bad = {
      ...db,
      from: (t: string) =>
        t === "orders"
          ? {
              select: () => ({
                in: () => ({
                  order: () => ({
                    range: async () => ({ data: null, error: { message: "boom" } }),
                  }),
                }),
              }),
            }
          : db.from(t),
    };
    await expect(
      segmentMembers(ctx(bad as unknown as FakeDb), { kind: "orders_min", min: 1 }, NOW),
    ).rejects.toThrow();
  });

  it("домен ходит в базу только через ctx.db, serviceDb не нужен", () => {
    for (const f of ["saved-segments.ts", "card-extra.ts"])
      expect(readFileSync(`src/core/customers/${f}`, "utf8")).not.toMatch(/serviceDb/);
  });
});

describe("сохранённые сегменты", () => {
  it("десять одновременных сохранений — все десять в списке, повторное имя не теряет другое", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    const c = ctx(db);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveSegment(c, { name: `Сегмент ${i}`, rule: { kind: "orders_min", min: i + 1 } }),
      ),
    );
    const list = await listSegments(c);
    expect(list.map((s) => s.name).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `Сегмент ${i}`).sort(),
    );
  });

  it("лимит и удаление", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    const c = ctx(db);
    for (let i = 0; i < MAX_SEGMENTS; i++)
      await saveSegment(c, { name: `S${i}`, rule: { kind: "inactive", days: i + 1 } });
    await expect(
      saveSegment(c, { name: "лишний", rule: { kind: "tag", tag: "x" } }),
    ).rejects.toMatchObject({
      key: "err.segment.limit",
    });
    const first = (await listSegments(c))[0]!;
    await deleteSegment(c, first.id);
    expect(await listSegments(c)).toHaveLength(MAX_SEGMENTS - 1);
    await expect(
      saveSegment(c, { name: "  ", rule: { kind: "tag", tag: "x" } }),
    ).rejects.toMatchObject({
      key: "err.segment.name",
    });
  });
});

describe("карточка покупателя: рефералы и отзывы", () => {
  it("кого пригласил, кто пригласил, награда только у получившего", async () => {
    const db = fakeDb();
    db.tables.bot_users = [user(1), user(2), user(3), user(9)];
    db.tables.referrals = [
      {
        id: uid(1),
        bot_id: "b",
        referrer_telegram_id: 1,
        referred_telegram_id: 2,
        status: "rewarded",
        reward_promo_code: "X",
        created_at: ago(5),
        rewarded_at: ago(3),
      },
      {
        id: uid(2),
        bot_id: "b",
        referrer_telegram_id: 1,
        referred_telegram_id: 3,
        status: "pending",
        reward_promo_code: null,
        created_at: ago(2),
        rewarded_at: null,
      },
      {
        id: uid(3),
        bot_id: "b",
        referrer_telegram_id: 9,
        referred_telegram_id: 1,
        status: "pending",
        reward_promo_code: null,
        created_at: ago(8),
        rewarded_at: null,
      },
    ];
    const r = await customerReferrals(ctx(db), 1);
    expect(r.invitedBy).toEqual({ telegramId: 9, name: "Покупатель 9" });
    expect(r.invited.map((x) => [x.telegramId, x.rewarded])).toEqual([
      [3, false],
      [2, true],
    ]);
  });

  it("отзывы с названием товара, свежие первыми; чужих покупателей нет", async () => {
    const db = fakeDb();
    db.tables.products = [{ id: uid(100), name: "Торт", bot_id: "b" }];
    db.tables.product_reviews = [
      {
        id: uid(1),
        bot_id: "b",
        product_id: uid(100),
        telegram_id: 1,
        rating: 4,
        comment: "ок",
        created_at: ago(5),
        updated_at: ago(5),
      },
      {
        id: uid(2),
        bot_id: "b",
        product_id: uid(100),
        telegram_id: 1,
        rating: 5,
        comment: null,
        created_at: ago(1),
        updated_at: ago(1),
      },
      {
        id: uid(3),
        bot_id: "b",
        product_id: uid(100),
        telegram_id: 2,
        rating: 1,
        comment: "чужой",
        created_at: ago(1),
        updated_at: ago(1),
      },
    ];
    const r = await customerReviews(ctx(db), [1]);
    expect(r.map((x) => x.rating)).toEqual([5, 4]);
    expect(r[0]!.productName).toBe("Торт");
  });
});
