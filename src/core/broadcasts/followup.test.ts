import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { createBroadcast, processBroadcastBatch, resolveAudience } from "./broadcasts";
import { parseSegment } from "./segments";
import { ATTRIBUTION_MS, withoutOrders } from "./revenue";

const BOT = "00000000-0000-0000-0000-000000000001";
const SRC = "11111111-1111-4111-8111-111111111111";
const SENT = new Date(Date.now() - 5 * 24 * 3600_000).toISOString();
const at = (hours: number) => new Date(Date.parse(SENT) + hours * 3600_000).toISOString();
const OTHER = "33333333-3333-4333-8333-333333333333";
const SEGMENT = { kind: "broadcast", id: SRC, who: "no_order" } as const;

/**
 * Исходная рассылка получена семью людьми: 1 заказал, 2 заказал позже окна,
 * 3 отписался, 4 уже получил сегодня маркетинговое сообщение, 5 заблокирован,
 * 6 заказ отменён, 7 ничего не делал.
 */
function setup(over: { src?: Record<string, unknown> } = {}) {
  const db = fakeDb();
  const user = (id: number, extra: Record<string, unknown> = {}) => ({
    bot_id: BOT,
    telegram_id: id,
    user_key: `tg_${id}`,
    platform: "telegram",
    state: { mode: "idle" },
    opt_out: false,
    ...extra,
  });
  db.tables.bot_users = [
    user(1),
    user(2),
    user(3, { opt_out: true }),
    user(4, { state: { mode: "idle", last_marketing_at: new Date().toISOString() } }),
    user(5),
    user(6),
    user(7),
  ];
  db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 5 }];
  db.tables.broadcasts = [
    {
      id: SRC,
      bot_id: BOT,
      channel: "telegram",
      status: "completed",
      audience_filter: {},
      created_at: SENT,
      ...over.src,
    },
  ];
  db.tables.broadcast_recipients = [1, 2, 3, 4, 5, 6, 7].map((id) => ({
    id: `r${id}`,
    bot_id: BOT,
    broadcast_id: SRC,
    telegram_id: id,
    status: "sent",
    sent_at: SENT,
  }));
  const order = (id: number, tg: number, created_at: string, status: string) => ({
    id,
    bot_id: BOT,
    telegram_id: tg,
    platform: "telegram",
    created_at,
    status,
    total: 1000,
    currency: "KZT",
  });
  db.tables.orders = [
    order(1, 1, at(3), "delivered"),
    order(2, 2, at(ATTRIBUTION_MS / 3600_000 + 5), "delivered"),
    order(3, 6, at(3), "cancelled"),
  ];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: BOT, ownerTelegramId: null, modules: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("«Дослать не купившим»", () => {
  it("сегмент разбирается; мусор и чужой вид — нет", () => {
    expect(parseSegment(SEGMENT)).toEqual(SEGMENT);
    expect(parseSegment({ kind: "broadcast", id: "x", who: "no_order" })).toBeNull();
    expect(parseSegment({ kind: "broadcast", id: SRC, who: "buyers" })).toBeNull();
  });

  it("не заказавшие: заказ в окне исключает, заказ позже окна и отменённый — нет", () => {
    const { db } = setup();
    const sent = (db.tables.broadcast_recipients ?? []).map((r) => ({
      telegram_id: Number(r.telegram_id),
      sent_at: String(r.sent_at),
    }));
    const orders = (db.tables.orders ?? []).map((o) => ({
      telegram_id: Number(o.telegram_id),
      created_at: String(o.created_at),
      status: String(o.status),
      total: 1000,
      currency: "KZT",
    }));
    expect([...withoutOrders(sent, orders)].sort()).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("аудитория: без заказавших, отписавшихся, заблокированных и тех, кому сегодня уже писали", async () => {
    const { ctx } = setup();
    const ids = await resolveAudience(ctx, "all", { segment: SEGMENT });
    expect(ids.sort()).toEqual([2, 6, 7]);
  });

  it("чужая или незавершённая исходная рассылка — пустая аудитория", async () => {
    expect(
      await resolveAudience(setup({ src: { status: "sending" } }).ctx, "all", { segment: SEGMENT }),
    ).toEqual([]);
    expect(
      await resolveAudience(setup({ src: { channel: "whatsapp" } }).ctx, "all", {
        segment: SEGMENT,
      }),
    ).toEqual([]);
    expect(
      await resolveAudience(setup().ctx, "all", {
        segment: { ...SEGMENT, id: "22222222-2222-4222-8222-222222222222" },
      }),
    ).toEqual([]);
  });

  it("досылку саму досылать нельзя: сервер отказывает, никто не получает третье касание", async () => {
    const { ctx, db } = setup({
      src: { audience_filter: { segment: { kind: "broadcast", id: OTHER, who: "no_order" } } },
    });
    const before = (db.tables.broadcast_recipients ?? []).length;
    await expect(resolveAudience(ctx, "all", { segment: SEGMENT })).rejects.toMatchObject({
      key: "err.broadcast.followupOfFollowup",
    });
    await expect(
      createBroadcast(ctx, {
        text: "Ещё раз",
        photoKeys: [],
        productIds: [],
        showCatalog: false,
        audience: "all",
        filter: { segment: SEGMENT },
      }),
    ).rejects.toMatchObject({ key: "err.broadcast.followupOfFollowup" });
    expect((db.tables.broadcast_recipients ?? []).length).toBe(before);
  });

  it("пока окно 72 часа не закрыто, «дослать» через час после отправки отказывает", async () => {
    const { ctx, db } = setup();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    for (const r of db.tables.broadcast_recipients ?? []) r.sent_at = hourAgo;
    await expect(resolveAudience(ctx, "all", { segment: SEGMENT })).rejects.toMatchObject({
      key: "err.broadcast.followupWindowOpen",
    });
  });

  it("рассылка создаётся с этим сегментом и теми же получателями", async () => {
    const { ctx, db } = setup();
    const r = await createBroadcast(ctx, {
      text: "Ещё раз про скидку",
      photoKeys: [],
      productIds: [],
      showCatalog: false,
      audience: "all",
      filter: { segment: SEGMENT },
    });
    expect(r.ok).toBe(true);
    const mine = (db.tables.broadcast_recipients ?? []).filter((x) => x.broadcast_id !== SRC);
    expect(mine.map((x) => Number(x.telegram_id)).sort()).toEqual([2, 6, 7]);
  });

  it("при отправке место под маркетинг занимается до сообщения; кому уже писали — не шлём", async () => {
    const { ctx, db } = setup();
    const created = await createBroadcast(ctx, {
      text: "Ещё раз",
      photoKeys: [],
      productIds: [],
      showCatalog: false,
      audience: "all",
      filter: { segment: SEGMENT },
    });
    if (!created.ok) throw new Error("не создалась");
    // Пока рассылка ждала, покупателю 6 написала автоворонка.
    const u6 = (db.tables.bot_users ?? []).find((u) => u.telegram_id === 6)!;
    u6.state = { mode: "idle", last_marketing_at: new Date().toISOString() };
    const sent: number[] = [];
    await processBroadcastBatch(ctx, async ({ telegramId }) => {
      sent.push(telegramId);
    });
    expect(sent.sort()).toEqual([2, 7]);
    const row = (id: number) =>
      (db.tables.broadcast_recipients ?? []).find(
        (r) => r.broadcast_id === created.broadcast.id && Number(r.telegram_id) === id,
      )!;
    expect(row(6)).toMatchObject({ status: "blocked", error_message: "потолок сообщений в сутки" });
    expect(row(2).status).toBe("sent");
    // Метка поставлена победителю: второе касание в тот же день ему уже не уйдёт.
    const u2 = (db.tables.bot_users ?? []).find((u) => u.telegram_id === 2)!;
    expect((u2.state as { last_marketing_at?: string }).last_marketing_at).toBeTruthy();
  });

  it("два крона одновременно: каждому получателю уходит ровно одно сообщение", async () => {
    const { ctx } = setup();
    const created = await createBroadcast(ctx, {
      text: "Ещё раз",
      photoKeys: [],
      productIds: [],
      showCatalog: false,
      audience: "all",
      filter: { segment: SEGMENT },
    });
    expect(created.ok).toBe(true);
    const sent: number[] = [];
    const send = async ({ telegramId }: { telegramId: number }) => {
      sent.push(telegramId);
    };
    await Promise.all([processBroadcastBatch(ctx, send), processBroadcastBatch(ctx, send)]);
    expect(sent.sort()).toEqual([2, 6, 7]);
  });
});
