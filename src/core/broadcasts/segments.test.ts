import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  MAX_SCHEDULED,
  audienceCountries,
  resolveWhatsAppAudience,
  createBroadcast,
  hasActiveBroadcast,
  isDue,
  processBroadcastBatch,
  resolveAudience,
} from "./broadcasts";
import { clickMark, clicksFor, recordClick, splitClickMark } from "./clicks";
import { inactiveSince, parseSegment } from "./segments";

const BOT = "00000000-0000-0000-0000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const CAT = "33333333-3333-4333-8333-333333333333";
const DAY = 24 * 3600_000;

/** Колонки таблицы из сгенерированных типов базы (Row). */
function realColumns(table: string): Set<string> {
  const src = readFileSync("src/core/db-types.ts", "utf8");
  const at = src.indexOf(`      ${table}: {\n        Row: {`);
  if (at < 0) throw new Error(`нет таблицы ${table} в db-types`);
  const body = src.slice(at, src.indexOf("        };", at));
  return new Set([...body.matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]!));
}

function setup() {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      telegram_id: 101,
      user_key: "tg_101",
      platform: "telegram",
      state: { locale: "kk" },
      opt_out: false,
    },
    {
      telegram_id: 102,
      user_key: "tg_102",
      platform: "telegram",
      state: { locale: "ru" },
      opt_out: false,
    },
    // Отписался — не попадает ни в какой сегмент, даже купив.
    {
      telegram_id: 103,
      user_key: "tg_103",
      platform: "telegram",
      state: { locale: "kk" },
      opt_out: true,
    },
    // Заблокирован продавцом.
    {
      telegram_id: 104,
      user_key: "tg_104",
      platform: "telegram",
      state: { locale: "kk" },
      opt_out: false,
    },
    { telegram_id: 105, user_key: "tg_105", platform: "telegram", state: null, opt_out: false },
  ];
  db.tables.blocked_users = [{ telegram_id: 104 }];
  const old = new Date(Date.now() - 90 * DAY).toISOString();
  const fresh = new Date(Date.now() - 2 * DAY).toISOString();
  db.tables.orders = [
    { id: 1, telegram_id: 101, platform: "telegram", status: "delivered", created_at: old },
    { id: 2, telegram_id: 102, platform: "telegram", status: "delivered", created_at: fresh },
    { id: 3, telegram_id: 103, platform: "telegram", status: "delivered", created_at: old },
    { id: 4, telegram_id: 104, platform: "telegram", status: "delivered", created_at: old },
    // Не оплачен — не покупка.
    { id: 5, telegram_id: 105, platform: "telegram", status: "pending", created_at: old },
  ];
  db.tables.order_items = [
    { order_id: 1, product_id: P1 },
    { order_id: 2, product_id: P2 },
    { order_id: 3, product_id: P1 },
    { order_id: 4, product_id: P1 },
    { order_id: 5, product_id: P1 },
  ];
  db.tables.products = [
    { id: P1, category_id: null, category_ids: [CAT] },
    { id: P2, category_id: null, category_ids: [] },
  ];
  db.tables.cart_items = [
    { id: 1, telegram_id: 105 },
    { id: 2, telegram_id: 103 },
  ];
  // Теги продавца — строки customer_note:<user_key> (карточка покупателя).
  db.tables.app_settings = [
    { key: "customer_note:tg_101", value: JSON.stringify({ tags: ["VIP"], note: "" }) },
    { key: "customer_note:tg_103", value: JSON.stringify({ tags: ["vip"], note: "" }) },
  ];
  const ctx = { tenant: { id: BOT, ownerTelegramId: null }, db } as unknown as TenantContext;
  return { db, ctx };
}

const seg = (s: unknown) => ({ segment: parseSegment(s)! });

describe("parseSegment", () => {
  it("мусор и неполные сегменты — null", () => {
    expect(parseSegment(null)).toBeNull();
    expect(parseSegment({ kind: "product", productId: "x" })).toBeNull();
    expect(parseSegment({ kind: "inactive", days: 0 })).toBeNull();
    expect(parseSegment({ kind: "inactive", days: 99999 })).toBeNull();
    expect(parseSegment({ kind: "language", locale: "fr" })).toBeNull();
    expect(parseSegment({ kind: "tag", tag: "  " })).toBeNull();
    expect(parseSegment({ kind: "drop table" })).toBeNull();
  });

  it("корректные сегменты проходят", () => {
    expect(parseSegment({ kind: "inactive", days: "30" })).toEqual({ kind: "inactive", days: 30 });
    expect(parseSegment({ kind: "tag", tag: " vip " })).toEqual({ kind: "tag", tag: "vip" });
    expect(parseSegment({ kind: "cart" })).toEqual({ kind: "cart" });
  });
});

describe("inactiveSince", () => {
  it("смотрит на последнюю покупку, а не на любую", () => {
    const now = Date.parse("2026-09-27T00:00:00Z");
    const set = inactiveSince(
      [
        { telegram_id: 1, created_at: "2026-06-01T00:00:00Z" },
        { telegram_id: 1, created_at: "2026-09-25T00:00:00Z" },
        { telegram_id: 2, created_at: "2026-06-01T00:00:00Z" },
      ],
      30,
      now,
    );
    expect([...set]).toEqual([2]);
  });
});

describe("сегменты: отписавшиеся и заблокированные не попадают никогда", () => {
  it("купили товар", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "all", seg({ kind: "product", productId: P1 }))).toEqual([
      101,
    ]);
  });

  it("купили из категории (category_ids)", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "all", seg({ kind: "category", categoryId: CAT }))).toEqual([
      101,
    ]);
  });

  it("не покупали N дней", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "all", seg({ kind: "inactive", days: 30 }))).toEqual([101]);
  });

  it("язык бота", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "all", seg({ kind: "language", locale: "kk" }))).toEqual([
      101,
    ]);
  });

  it("тег без учёта регистра", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "all", seg({ kind: "tag", tag: "vip" }))).toEqual([101]);
  });

  it("брошенная корзина", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "all", seg({ kind: "cart" }))).toEqual([105]);
  });

  it("«купившие» тоже без отписавшихся и заблокированных", async () => {
    const { ctx } = setup();
    expect((await resolveAudience(ctx, "buyers")).sort()).toEqual([101, 102]);
  });
});

describe("клики по кнопкам рассылки", () => {
  it("метка отрезается от callback_data и влезает в 64 байта", () => {
    const mark = clickMark("abcdef12-3456-7890-abcd-ef1234567890");
    expect(mark).toBe("babcdef12");
    const data = `prod:${P1}:${mark}`;
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(splitClickMark(data)).toEqual({ data: `prod:${P1}`, mark });
    expect(splitClickMark(`prod:${P1}`)).toEqual({ data: `prod:${P1}`, mark: null });
  });

  it("нажатия считаются по рассылке", async () => {
    const { ctx } = setup();
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    await recordClick(ctx, clickMark(id));
    await recordClick(ctx, clickMark(id));
    await recordClick(ctx, "не метка");
    expect(await clicksFor(ctx, [id, "00000000-0000-0000-0000-000000000009"])).toEqual({ [id]: 2 });
  });
});

describe("расписание рассылки", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  it("isDue: без срока — сразу, со сроком — не раньше", () => {
    expect(isDue({ audience_filter: {} }, now)).toBe(true);
    expect(isDue({ audience_filter: { send_at: "2026-09-27T11:00:00Z" } }, now)).toBe(false);
    expect(isDue({ audience_filter: { send_at: "2026-09-27T09:59:00Z" } }, now)).toBe(true);
  });

  function queued(db: FakeDb, sendAt: string | null, recipients: number[]) {
    db.tables.broadcasts = [
      {
        id: "b1",
        bot_id: BOT,
        status: "queued",
        channel: "telegram",
        message_text: "привет",
        photo_paths: [],
        product_ids: [],
        show_catalog: false,
        audience_filter: sendAt ? { send_at: sendAt } : {},
        total_count: recipients.length,
        sent_count: 0,
        failed_count: 0,
        blocked_count: 0,
        created_at: "2026-09-26T00:00:00Z",
      },
    ];
    db.tables.broadcast_recipients = recipients.map((id, i) => ({
      id: `r${i}`,
      bot_id: BOT,
      broadcast_id: "b1",
      telegram_id: id,
      phone: null,
      status: "pending",
      sent_at: null,
      error_message: null,
    }));
  }

  it("крон не отправляет запланированную рассылку раньше срока", async () => {
    const { db, ctx } = setup();
    queued(db, new Date(Date.now() + DAY).toISOString(), [101]);
    const sent: number[] = [];
    const r = await processBroadcastBatch(
      ctx,
      async ({ telegramId }) => void sent.push(telegramId),
    );
    expect(r.broadcastId).toBeNull();
    expect(sent).toEqual([]);
    expect(db.tables.broadcasts![0]!.status).toBe("queued");
  });

  it("к сроку отписавшиеся и заблокированные с момента создания не получают", async () => {
    const { db, ctx } = setup();
    queued(db, new Date(Date.now() - 1000).toISOString(), [101, 103, 104]);
    const sent: number[] = [];
    await processBroadcastBatch(ctx, async ({ telegramId }) => void sent.push(telegramId));
    expect(sent).toEqual([101]);
    const rows = db.tables.broadcast_recipients!;
    expect(rows.find((r) => r.telegram_id === 103)!.status).toBe("blocked");
    expect(rows.find((r) => r.telegram_id === 104)!.status).toBe("blocked");
  });
});

describe("постраничное чтение: порядок по уникальному ключу", () => {
  it("каждая листаемая выборка аудитории и сегментов упорядочена по id", async () => {
    const { db, ctx } = setup();
    // Без уникального порядка PostgREST может отдать страницы с пропусками
    // и повторами — покупатели молча выпадали бы из сегмента.
    const paged: Array<{ table: string; orders: string[] }> = [];
    const origFrom = db.from.bind(db);
    (db as { from: typeof db.from }).from = ((table: string) => {
      const q = origFrom(table);
      const orders: string[] = [];
      const order = q.order.bind(q);
      const range = q.range.bind(q);
      q.order = ((col: string, o?: unknown) => {
        orders.push(col);
        return order(col, o as never);
      }) as typeof q.order;
      q.range = ((from: number, to: number) => {
        paged.push({ table, orders: [...orders] });
        return range(from, to);
      }) as typeof q.range;
      return q;
    }) as typeof db.from;
    for (const s of [
      { kind: "product", productId: P1 },
      { kind: "category", categoryId: CAT },
      { kind: "inactive", days: 30 },
      { kind: "cart" },
      { kind: "tag", tag: "vip" },
    ])
      await resolveAudience(ctx, "all", seg(s));
    await resolveAudience(ctx, "buyers");
    await resolveAudience(ctx, "non_buyers");
    await resolveWhatsAppAudience(ctx, "all");
    await audienceCountries(ctx);
    expect(new Set(paged.map((p) => p.table))).toEqual(
      new Set([
        "bot_users",
        "blocked_users",
        "orders",
        "order_items",
        "products",
        "cart_items",
        "app_settings",
      ]),
    );
    // Порядок — по уникальной колонке, которая в таблице действительно есть
    // (подставная база несуществующую колонку не заметит, PostgREST вернёт 400).
    const UNIQUE: Record<string, string> = {
      bot_users: "user_key",
      blocked_users: "telegram_id",
      app_settings: "key",
    };
    const unordered = paged.filter(
      (p) =>
        !p.orders.includes(UNIQUE[p.table] ?? "id") ||
        p.orders.some((c) => !realColumns(p.table).has(c)),
    );
    expect(unordered).toEqual([]);
  });
});

describe("запланированная рассылка не занимает канал", () => {
  const CONTENT = { photoKeys: [], productIds: [], showCatalog: false };
  const future = () => new Date(Date.now() + 3 * DAY).toISOString();

  function withSchedule() {
    const s = setup();
    s.db.tables.broadcasts = [];
    s.db.tables.broadcast_recipients = [];
    s.db.tables.app_settings!.push({ key: "admin_telegram_ids", value: "101" });
    return s;
  }

  it("пока ждёт срока — можно отправить другую рассылку и пробную себе", async () => {
    const { ctx } = withSchedule();
    const later = await createBroadcast(ctx, {
      ...CONTENT,
      text: "Потом",
      audience: "all",
      filter: { send_at: future() },
    });
    expect(later.ok).toBe(true);
    expect(await hasActiveBroadcast(ctx)).toBe(false);
    const now = await createBroadcast(ctx, { ...CONTENT, text: "Сейчас", audience: "all" });
    expect(now.ok).toBe(true);
    // А вот вторую немедленную, пока первая идёт, — нельзя.
    const busy = await createBroadcast(ctx, { ...CONTENT, text: "Ещё", audience: "all" });
    expect(busy).toMatchObject({ ok: false, reason: "busy" });
    // Запланировать ещё одну на потом — можно.
    const later2 = await createBroadcast(ctx, {
      ...CONTENT,
      text: "Потом 2",
      audience: "all",
      filter: { send_at: future() },
    });
    expect(later2.ok).toBe(true);
  });

  it("срок настал — канал занят, как идущей рассылкой", async () => {
    const { db, ctx } = withSchedule();
    await createBroadcast(ctx, {
      ...CONTENT,
      text: "Потом",
      audience: "all",
      filter: { send_at: future() },
    });
    (db.tables.broadcasts![0]!.audience_filter as { send_at: string }).send_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    expect(await hasActiveBroadcast(ctx)).toBe(true);
    const r = await createBroadcast(ctx, { ...CONTENT, text: "Сейчас", audience: "all" });
    expect(r).toMatchObject({ ok: false, reason: "busy" });
  });

  it("запланировать можно не больше MAX_SCHEDULED наперёд", async () => {
    const { ctx } = withSchedule();
    for (let i = 0; i < MAX_SCHEDULED; i++)
      expect(
        (
          await createBroadcast(ctx, {
            ...CONTENT,
            text: `№${i}`,
            audience: "all",
            filter: { send_at: future() },
          })
        ).ok,
      ).toBe(true);
    const over = await createBroadcast(ctx, {
      ...CONTENT,
      text: "лишняя",
      audience: "all",
      filter: { send_at: future() },
    });
    expect(over).toMatchObject({ ok: false, reason: "busy" });
  });
});
