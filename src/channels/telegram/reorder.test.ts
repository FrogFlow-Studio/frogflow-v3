import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramApi } from "./api";

/** Б11: «как в прошлый раз» в Telegram — словом и кнопкой. */
beforeEach(() => setEnvForTests({}));
afterEach(() => setEnvForTests(undefined));

const BOT = "bot-1";
const product = (id: string, active = true) => ({
  id,
  bot_id: BOT,
  name: id,
  price: 200,
  currency: "KZT",
  is_active: active,
  stock_quantity: null,
  fulfillment_kind: "digital",
  file_path: `${BOT}/${id}.pdf`,
  file_url: null,
  file_path_kz: null,
  file_url_kz: null,
  product_material_files: [],
});
const order = (id: number, telegramId: number, status = "delivered") => ({
  id,
  order_no: id,
  bot_id: BOT,
  telegram_id: telegramId,
  status,
  created_at: "2026-09-20T10:00:00Z",
  order_items: [
    { id: `${id}a`, product_id: "a", product_variant_id: null, name_snapshot: "Гайд", quantity: 1 },
    {
      id: `${id}c`,
      product_id: "c",
      product_variant_id: null,
      name_snapshot: "Снятое",
      quantity: 1,
    },
  ],
});

function setup(orders: Array<Record<string, unknown>>) {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      user_key: "tg_42",
      bot_id: BOT,
      platform: "telegram",
      telegram_id: 42,
      first_name: "Аня",
      state: { locale: "ru", mode: "idle" },
    },
  ];
  db.tables.orders = orders;
  db.tables.products = [product("a"), product("c", false)];
  db.tables.cart_items = [];
  db.tables.product_variants = [];
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  const ctx = {
    tenant: {
      id: BOT,
      status: "active",
      vertical: "digital",
      modules: {},
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const texts: string[] = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown>) => {
      if (method === "sendMessage") texts.push(String(p.text));
      return { ok: true, result: { message_id: 1 } };
    }),
  } as unknown as TelegramApi;
  const say = (text: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        text,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Аня" },
      },
    } as never);
  const tap = (data: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 2,
      callback_query: {
        id: "cq",
        from: { id: 42, is_bot: false, first_name: "Аня" },
        data,
        message: { message_id: 1, date: 0, chat: { id: 42, type: "private" } },
      },
    } as never);
  return { db, say, tap, texts };
}

describe("Telegram: как в прошлый раз", () => {
  it("«повторить» — последний оплаченный заказ в корзину, снятое названо", async () => {
    const { say, db, texts } = setup([order(1, 42)]);
    await say("Повторить");
    expect(db.tables.cart_items!.map((c) => c.product_id)).toEqual(["a"]);
    const all = texts.join("\n");
    expect(all).toContain("Добавил в корзину 1 поз. из прошлого заказа");
    expect(all).toContain("Нет в наличии или стало меньше: Снятое.");
  });

  it("нет оплаченного (только отклонённый) — подсказка, корзина пуста", async () => {
    const { say, db, texts } = setup([order(1, 42, "rejected")]);
    await say("как в прошлый раз");
    expect(texts).toContain("Прошлых оплаченных заказов пока нет — откройте каталог.");
    expect(db.tables.cart_items).toEqual([]);
  });

  it("кнопка «Повторить заказ» с чужим номером ничего не кладёт", async () => {
    const { tap, db } = setup([order(5, 99)]);
    await tap("reorder:5");
    expect(db.tables.cart_items).toEqual([]);
  });
});
