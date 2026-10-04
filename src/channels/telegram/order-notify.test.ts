import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OrderWithItems } from "@/core/orders/orders";
import { adminNotifySettingKey, parseAdminNotifyPack } from "@/core/notify/order-pack";
import { notifyAdminNewOrder } from "./admin-notify";
import { flushDueOrderNotify, scheduleOrderNotifyDismiss } from "./order-notify";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramApi } from "./api";

/**
 * Уведомление продавцу о заказе, как в v1: после «подтвердить»/«отклонить»
 * кнопки снимаются сразу, а через 5 минут минутный крон убирает сообщения из
 * чатов всех продавцов, чтобы чат не зарастал старыми заказами.
 */
const BOT = "bot-1";
const SELLERS = ["111", "222"];

function setup(order: Partial<OrderWithItems> = {}) {
  const db: FakeDb = fakeDb();
  db.tables.app_settings = [{ bot_id: BOT, key: "admin_chat_id", value: SELLERS.join(",") }];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      bot_id: BOT,
      telegram_id: 42,
      platform: "telegram",
      status: "awaiting_confirmation",
      total: 1000,
      currency: "KZT",
      fulfillment_kind: "digital",
      order_items: [],
      ...order,
    },
  ];
  const ctx = {
    tenant: { id: BOT, status: "active", modules: {}, settings: { default_locale: "ru" } },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  let nextId = 500;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown>) => {
      calls.push([method, p]);
      return { ok: true, result: method.startsWith("send") ? { message_id: nextId++ } : true };
    }),
  } as unknown as TelegramApi;
  const pack = () =>
    parseAdminNotifyPack(
      (db.tables.app_settings ?? []).find((r) => r.key === adminNotifySettingKey(7))?.value as
        string | undefined,
    );
  const order7 = () => db.tables.orders![0] as unknown as OrderWithItems;
  return { db, ctx, api, calls, pack, order7 };
}

const T0 = Date.parse("2026-09-26T12:00:00Z");

describe("уведомление продавцу о заказе убирается через 5 минут после решения", () => {
  it("запоминает сообщения уведомления у каждого продавца, текст с кнопками — с флагом", async () => {
    const { ctx, api, pack, order7 } = setup();
    await notifyAdminNewOrder(ctx, api, order7(), { fileId: "f", kind: "photo" });
    expect(pack()).toEqual({
      refs: [
        { chat_id: "111", message_id: 500, buttons: true },
        { chat_id: "111", message_id: 501, buttons: true },
        { chat_id: "222", message_id: 502, buttons: true },
        { chat_id: "222", message_id: 503, buttons: true },
      ],
      deleteAfter: null,
      createdAt: expect.any(String),
    });
  });

  it("после решения кнопки снимаются сразу, удаление — не раньше чем через 5 минут", async () => {
    const { ctx, api, calls, pack, order7 } = setup();
    await notifyAdminNewOrder(ctx, api, order7(), null);
    calls.length = 0;
    await scheduleOrderNotifyDismiss(ctx, api, 7, T0);
    expect(calls.map(([m, p]) => [m, p.chat_id, p.message_id])).toEqual([
      ["editMessageReplyMarkup", "111", 500],
      ["editMessageReplyMarkup", "222", 501],
    ]);
    expect(pack().deleteAfter).toBe(new Date(T0 + 5 * 60_000).toISOString());

    calls.length = 0;
    expect(await flushDueOrderNotify(ctx, api, T0 + 5 * 60_000 - 1)).toBe(0);
    expect(calls).toEqual([]);
    expect(await flushDueOrderNotify(ctx, api, T0 + 5 * 60_000)).toBe(1);
    expect(calls.map(([m, p]) => [m, p.chat_id, p.message_id])).toEqual([
      ["deleteMessage", "111", 500],
      ["deleteMessage", "222", 501],
    ]);
    expect(pack()).toEqual({ refs: [], deleteAfter: null });
  });

  it("два крона одновременно — каждое сообщение удаляется один раз", async () => {
    const { ctx, api, calls, order7 } = setup();
    await notifyAdminNewOrder(ctx, api, order7(), null);
    await scheduleOrderNotifyDismiss(ctx, api, 7, T0);
    calls.length = 0;
    const [a, b] = await Promise.all([
      flushDueOrderNotify(ctx, api, T0 + 5 * 60_000),
      flushDueOrderNotify(ctx, api, T0 + 5 * 60_000),
    ]);
    expect(a + b).toBe(1);
    expect(calls.filter(([m]) => m === "deleteMessage")).toHaveLength(2);
  });

  it("повторное решение не отодвигает срок удаления", async () => {
    const { ctx, api, pack, order7 } = setup();
    await notifyAdminNewOrder(ctx, api, order7(), null);
    await scheduleOrderNotifyDismiss(ctx, api, 7, T0);
    await scheduleOrderNotifyDismiss(ctx, api, 7, T0 + 60_000);
    expect(pack().deleteAfter).toBe(new Date(T0 + 5 * 60_000).toISOString());
  });

  it("кнопка «Отклонить» в Telegram ставит уведомление на удаление", async () => {
    const { ctx, api, pack, order7 } = setup();
    await notifyAdminNewOrder(ctx, api, order7(), null);
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      callback_query: {
        id: "cq",
        from: { id: 111, is_bot: false, first_name: "S" },
        data: "reject:7",
        message: { message_id: 500, date: 0, chat: { id: 111, type: "private" } },
      },
    } as never);
    expect(order7().status).toBe("rejected");
    expect(pack().deleteAfter).not.toBeNull();
  });

  it("пачка без решения старше недели забывается, чужие ключи и свежие пачки не трогаются", async () => {
    const { db, ctx, api, calls, pack, order7 } = setup();
    await notifyAdminNewOrder(ctx, api, order7(), null);
    expect(pack().createdAt).toBeTruthy();
    const created = Date.parse(pack().createdAt!);
    db.tables.app_settings!.push(
      { bot_id: BOT, key: "admin_notify_tg:7", value: "[]" },
      { bot_id: BOT, key: "v2_order_notify:8", value: JSON.stringify({ refs: [] }) },
    );
    calls.length = 0;
    expect(await flushDueOrderNotify(ctx, api, created + 6 * 24 * 3600_000)).toBe(0);
    expect(await flushDueOrderNotify(ctx, api, created + 8 * 24 * 3600_000)).toBe(1);
    // Сообщения старше 48 часов Telegram не удаляет — зовём его зря не будем.
    expect(calls).toEqual([]);
    expect(pack()).toEqual({ refs: [], deleteAfter: null });
    const keys = db.tables.app_settings!.map((r) => r.key);
    expect(keys).toContain("admin_notify_tg:7");
    // Пачка без createdAt и без updated_at — возраст неизвестен, остаётся.
    expect(keys).toContain("v2_order_notify:8");
  });
});

describe("уведомление о заказе-подарке", () => {
  const giftRow = {
    bot_id: BOT,
    event_id: "order:7:gift:once",
    event_type: "order.gift",
    status: "event",
    payload: { order_id: 7, recipient: "Анна <b>", message: "С днём рождения!", truncated: false },
  };
  const texts = (calls: Array<[string, Record<string, unknown>]>) =>
    calls.filter(([m]) => m === "sendMessage").map(([, p]) => String(p.text));

  it("отдельной строкой «🎁 Подарок для …» и текстом открытки, имя экранировано", async () => {
    const { ctx, db, api, calls, order7 } = setup();
    (ctx.tenant.modules as Record<string, boolean>).bundles = true;
    db.tables.zernio_logs = [giftRow];
    await notifyAdminNewOrder(ctx, api, order7(), null);
    const text = texts(calls)[0]!;
    expect(text).toContain("🎁 <b>Подарок для Анна &lt;b&gt;</b>");
    expect(text).toContain("💌 «С днём рождения!»");
  });

  it("без подарка строки нет", async () => {
    const { ctx, db, api, calls, order7 } = setup();
    (ctx.tenant.modules as Record<string, boolean>).bundles = true;
    db.tables.zernio_logs = [];
    await notifyAdminNewOrder(ctx, api, order7(), null);
    expect(texts(calls)[0]).not.toContain("🎁");
  });
});
