import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  parseRatingReply,
  reviewAskDays,
  reviewAskKey,
  runReviewAsk,
  type ReviewAsk,
  type ReviewAskSender,
} from "./ask";
import type { Customer } from "@/core/customers/customers";

const DAY = 86_400_000;
// 11:00 в Алматы.
const NOW = new Date("2026-09-27T06:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const P1 = "a0000000-0000-4000-8000-000000000001";
const P2 = "a0000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

function setup(
  opts: { settings?: Record<string, unknown>; modules?: Record<string, boolean> } = {},
) {
  // Ключ app_settings уникален в пределах магазина, как PK (bot_id, key) в базе.
  const db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.app_settings = [];
  db.tables.bot_users = [
    {
      user_key: "tg_1",
      telegram_id: 1,
      platform: "telegram",
      first_name: "Аня",
      opt_out: false,
      state: { locale: "ru" },
    },
    { user_key: "tg_2", telegram_id: 2, platform: "telegram", opt_out: true, state: {} },
    { user_key: "tg_3", telegram_id: 3, platform: "telegram", opt_out: false, state: {} },
    {
      user_key: "ig_4",
      telegram_id: -4,
      platform: "instagram",
      opt_out: false,
      state: { mode: "idle" },
      zernio_conversation_id: "c4",
      zernio_account_id: "a4",
    },
  ];
  db.tables.blocked_users = [{ telegram_id: 3 }];
  const order = (id: number, tg: number, updated: string, extra: Row = {}) => ({
    id,
    telegram_id: tg,
    display_no: id,
    order_no: id,
    status: "delivered",
    updated_at: updated,
    ...extra,
  });
  db.tables.orders = [
    order(10, 1, ago(4)),
    order(11, 2, ago(4)),
    order(12, 3, ago(4)),
    // Срок ещё не настал и срок упущен.
    order(13, 1000, ago(1)),
    order(14, 1001, ago(9)),
  ];
  db.tables.order_items = [10, 11, 12, 13, 14].map((id) => ({
    order_id: id,
    product_id: P1,
    name_snapshot: "Прописи",
  }));
  db.tables.product_reviews = [];
  db.tables.manager_chat_messages = [];
  const ctx = {
    tenant: {
      id: "bot",
      modules: opts.modules ?? { review_request: true },
      settings: opts.settings ?? {},
    },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

function collect(ok = true) {
  const sent: Array<{ to: Customer; ask: ReviewAsk }> = [];
  const send: ReviewAskSender = async (to, ask) => {
    sent.push({ to, ask });
    return ok;
  };
  return { sent, send };
}

describe("просьба об оценке: настройки и разбор ответа", () => {
  it("дни: целое 1–30, остальное — 3", () => {
    expect(reviewAskDays(undefined)).toBe(3);
    expect(reviewAskDays(7)).toBe(7);
    for (const bad of [0, 31, 2.5, "x", null, -1]) expect(reviewAskDays(bad)).toBe(3);
  });

  it("ответ — только цифра 1–5, можно со звездой", () => {
    expect(parseRatingReply("5")).toBe(5);
    expect(parseRatingReply(" 3 ⭐")).toBe(3);
    for (const t of ["0", "6", "55", "пять", "5 штук", "10", ""])
      expect(parseRatingReply(t)).toBeNull();
  });
});

describe("просьба об оценке: кому и когда", () => {
  it("Telegram: одна просьба на выданный заказ; второй проход молчит", async () => {
    const { ctx, db } = setup();
    const a = collect();
    const r = await runReviewAsk(ctx, a.send, NOW);
    expect(r).toMatchObject({ sent: 1 });
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]!.ask).toMatchObject({ orderId: 10, products: [{ id: P1, name: "Прописи" }] });
    expect(db.tables.app_settings!.some((s) => s.key === reviewAskKey(10))).toBe(true);
    const b = collect();
    await runReviewAsk(ctx, b.send, new Date(NOW.getTime() + 3_600_000));
    expect(b.sent).toHaveLength(0);
  });

  it("два крона одновременно — ровно одно сообщение", async () => {
    const { ctx } = setup();
    const a = collect();
    const b = collect();
    await Promise.all([runReviewAsk(ctx, a.send, NOW), runReviewAsk(ctx, b.send, NOW)]);
    expect(a.sent.length + b.sent.length).toBe(1);
  });

  it("отписавшийся и заблокированный — тишина, заказы закрыты", async () => {
    const { ctx, db } = setup();
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent.map((x) => x.to.telegramId)).toEqual([1]);
    const keys = db.tables.app_settings!.map((s) => s.key);
    expect(keys).toContain(reviewAskKey(11));
    expect(keys).toContain(reviewAskKey(12));
    // заказы вне окна (раньше срока и позже края) не трогаем
    expect(keys).not.toContain(reviewAskKey(13));
    expect(keys).not.toContain(reviewAskKey(14));
  });

  it("срок — настройка продавца", async () => {
    const { ctx } = setup({ settings: { review_ask_days: 5 } });
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent).toHaveLength(0);
  });

  it("уже оценённый товар не просим", async () => {
    const { ctx, db } = setup();
    db.tables.product_reviews = [{ id: "r1", telegram_id: 1, product_id: P1, rating: 4 }];
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent).toHaveLength(0);
  });

  it("несколько товаров — все не оценённые в одной просьбе", async () => {
    const { ctx, db } = setup();
    db.tables.order_items!.push({ order_id: 10, product_id: P2, name_snapshot: "Раскраска" });
    db.tables.product_reviews = [{ id: "r1", telegram_id: 1, product_id: P1, rating: 4 }];
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent[0]!.ask.products).toEqual([{ id: P2, name: "Раскраска" }]);
  });

  it("два заказа покупателя — одно сообщение по свежему, старый закрыт", async () => {
    const { ctx, db } = setup();
    db.tables.orders!.push({
      id: 20,
      telegram_id: 1,
      display_no: 20,
      order_no: 20,
      status: "delivered",
      updated_at: ago(3.5),
    });
    db.tables.order_items!.push({ order_id: 20, product_id: P2, name_snapshot: "Раскраска" });
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]!.ask.orderId).toBe(20);
    const b = collect();
    await runReviewAsk(ctx, b.send, new Date(NOW.getTime() + 3_600_000));
    expect(b.sent).toHaveLength(0);
  });

  it("ночью и при выключенном модуле — тишина", async () => {
    const a = collect();
    const night = await runReviewAsk(setup().ctx, a.send, new Date("2026-09-27T16:00:00Z"));
    expect(night.skipped).toBe("night");
    const off = await runReviewAsk(setup({ modules: {} }).ctx, a.send, NOW);
    expect(off.skipped).toBe("module off");
    expect(a.sent).toHaveLength(0);
  });

  it("недоставленное не повторяем: отметка остаётся", async () => {
    const { ctx } = setup();
    const a = collect(false);
    const r = await runReviewAsk(ctx, a.send, NOW);
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    const b = collect();
    await runReviewAsk(ctx, b.send, new Date(NOW.getTime() + 3_600_000));
    expect(b.sent).toHaveLength(0);
  });

  it("потолок маркетинговых сообщений занят: не пишем, отметку снимаем — возьмём позже", async () => {
    const { ctx, db } = setup();
    (db.tables.bot_users![0] as Row).state = {
      locale: "ru",
      last_marketing_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
    };
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent).toHaveLength(0);
    expect(db.tables.app_settings!.some((s) => s.key === reviewAskKey(10))).toBe(false);
    // Через сутки потолок освободился — просьба уходит.
    const b = collect();
    await runReviewAsk(ctx, b.send, new Date(NOW.getTime() + DAY - 3_600_000 + 1_000));
    expect(b.sent).toHaveLength(1);
  });

  it("сбой чтения заказов — serverFailure, а не «просить некого»", async () => {
    const { ctx } = setup();
    const db = ctx.db as unknown as { from: (t: string) => unknown };
    const real = db.from.bind(db);
    db.from = (t: string) =>
      t === "orders"
        ? {
            select: () => ({
              eq: () => ({
                gte: () => ({
                  lte: () => ({
                    order: () => ({
                      range: async () => ({ data: null, error: { message: "boom" } }),
                    }),
                  }),
                }),
              }),
            }),
          }
        : real(t);
    await expect(runReviewAsk(ctx, collect().send, NOW)).rejects.toThrow(/заказы: boom/);
  });
});

describe("просьба об оценке: старые отметки", () => {
  it("отметки старше N + 3 + 30 дней удаляются, свежие и чужие ключи остаются", async () => {
    const { db, ctx } = setup();
    const mark = (id: number, value: string) => ({
      bot_id: "bot",
      key: reviewAskKey(id),
      value,
      updated_at: value,
    });
    db.tables.app_settings = [
      mark(1, `ask:${ago(60)}`),
      mark(2, `skip:${ago(60)}`),
      mark(3, `ask:${ago(20)}`),
      mark(4, `skip:${ago(5)}`),
      { bot_id: "bot", key: "quiz", value: `ask:${ago(90)}`, updated_at: ago(90) },
    ];
    await runReviewAsk(ctx, collect().send, NOW);
    const keys = db.tables.app_settings!.map((r) => r.key);
    for (const id of [1, 2]) expect(keys).not.toContain(reviewAskKey(id));
    for (const id of [3, 4]) expect(keys).toContain(reviewAskKey(id));
    expect(keys).toContain("quiz");
  });
});

describe("просьба об оценке: потолок — на отправки", () => {
  it("60 покупателей Direct с закрытым окном не занимают проход у 20 покупателей Telegram", async () => {
    const { ctx, db } = setup();
    const igUsers: Row[] = [];
    const orders: Row[] = [];
    const items: Row[] = [];
    for (let i = 0; i < 60; i++) {
      const tg = -(100 + i);
      igUsers.push({
        user_key: `ig_${100 + i}`,
        telegram_id: tg,
        platform: "instagram",
        opt_out: false,
        state: { mode: "idle" },
        zernio_conversation_id: `c${i}`,
        zernio_account_id: "a",
      });
      orders.push({
        id: 100 + i,
        telegram_id: tg,
        display_no: 100 + i,
        order_no: 100 + i,
        status: "delivered",
        updated_at: ago(4),
      });
      items.push({ order_id: 100 + i, product_id: P1, name_snapshot: "Прописи" });
    }
    const tgUsers: Row[] = [];
    for (let i = 0; i < 20; i++) {
      const tg = 5000 + i;
      tgUsers.push({
        user_key: `tg_${tg}`,
        telegram_id: tg,
        platform: "telegram",
        opt_out: false,
        state: {},
      });
      orders.push({
        id: 1000 + i,
        telegram_id: tg,
        display_no: 1000 + i,
        order_no: 1000 + i,
        status: "delivered",
        updated_at: ago(4),
      });
      items.push({ order_id: 1000 + i, product_id: P1, name_snapshot: "Прописи" });
    }
    db.tables.bot_users = [...igUsers, ...tgUsers];
    db.tables.blocked_users = [];
    db.tables.orders = orders;
    db.tables.order_items = items;
    const a = collect();
    const res = await runReviewAsk(ctx, a.send, NOW);
    expect(res.sent).toBe(20);
    expect(a.sent.every((x) => x.to.platform === "telegram")).toBe(true);
    // Ждущие окна заказы остались открытыми: отметок на них нет.
    expect(db.tables.app_settings).toHaveLength(20);
  });
});

describe("просьба об оценке: Instagram и WhatsApp — только в окне 24 часа", () => {
  const inbound = (hoursAgo: number) => ({
    telegram_id: -4,
    direction: "in",
    created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  });
  const igOrder = {
    id: 30,
    telegram_id: -4,
    display_no: 30,
    order_no: 30,
    status: "delivered",
    updated_at: ago(4),
  };

  it("вне окна — тишина и отметки нет; вошёл в окно — просьба, диалог ждёт цифру", async () => {
    const { ctx, db } = setup();
    db.tables.orders = [igOrder];
    db.tables.order_items = [{ order_id: 30, product_id: P1, name_snapshot: "Прописи" }];
    db.tables.manager_chat_messages = [inbound(30)];
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent).toHaveLength(0);
    expect(db.tables.app_settings).toHaveLength(0);

    db.tables.manager_chat_messages = [inbound(2)];
    const b = collect();
    await runReviewAsk(ctx, b.send, NOW);
    expect(b.sent).toHaveLength(1);
    const state = (db.tables.bot_users!.find((u) => u.user_key === "ig_4") as Row).state as Row;
    expect(state).toMatchObject({
      mode: "awaiting_rating",
      review_product_id: P1,
      review_ask_at: NOW.toISOString(),
    });
    expect(b.sent[0]!.to.state.mode).toBe("awaiting_rating");
  });

  it("покупатель посреди оформления — не перебиваем", async () => {
    const { ctx, db } = setup();
    db.tables.orders = [igOrder];
    db.tables.order_items = [{ order_id: 30, product_id: P1, name_snapshot: "Прописи" }];
    db.tables.manager_chat_messages = [inbound(2)];
    (db.tables.bot_users!.find((u) => u.user_key === "ig_4") as Row).state = {
      mode: "awaiting_address",
    };
    const a = collect();
    await runReviewAsk(ctx, a.send, NOW);
    expect(a.sent).toHaveLength(0);
    expect(db.tables.app_settings).toHaveLength(0);
  });
});
