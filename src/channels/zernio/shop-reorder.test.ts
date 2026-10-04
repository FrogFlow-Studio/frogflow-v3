import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";
import type { ParsedZernioMessage } from "./message";
import { handleShopMessage } from "./shop.server";
import { matchDirectCommand } from "./shop-flow";

/** Б11: «как в прошлый раз» в Direct и WhatsApp. */
beforeEach(() => setEnvForTests({}));
afterEach(() => setEnvForTests(undefined));

const BOT = "bot-1";
const product = (id: string, name: string, price: number, active = true) => ({
  id,
  bot_id: BOT,
  name,
  price,
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

function setup(state: Record<string, unknown>, orders: Array<Record<string, unknown>>) {
  const db = fakeDb();
  db.tables.bot_users = [
    { user_key: "ig_1", bot_id: BOT, platform: "instagram", telegram_id: -1, state },
  ];
  db.tables.orders = orders;
  // Гайд подорожал с 100 (в заказе) до 200 (в каталоге), «Снятое» снято с продажи.
  db.tables.products = [product("a", "Гайд", 200), product("c", "Снятое", 50, false)];
  db.tables.cart_items = [];
  db.tables.product_variants = [];
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  const ctx = {
    tenant: { id: BOT, status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const customer = () =>
    ({
      userKey: "ig_1",
      platform: "instagram",
      telegramId: -1,
      loyaltyPoints: 0,
      state: db.tables.bot_users![0]!.state,
    }) as unknown as Customer;
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
    mailReady: () => false,
  } as unknown as ZernioTransport;
  const say = (text: string, postbackPayload: string | null = null) =>
    handleShopMessage(
      ctx,
      customer(),
      {
        conversationId: "c1",
        accountId: "a1",
        platform: "instagram",
        senderId: "1",
        text,
        postbackPayload,
        nativeOrder: null,
        attachments: [],
        mediaWithoutUrl: false,
      } as unknown as ParsedZernioMessage,
      transport,
    );
  return { db, say, sent };
}

const paid = (id: number, telegramId = -1) => ({
  id,
  bot_id: BOT,
  telegram_id: telegramId,
  status: "delivered",
  created_at: "2026-09-20T10:00:00Z",
  order_items: [
    {
      id: `i${id}a`,
      product_id: "a",
      product_variant_id: null,
      name_snapshot: "Гайд",
      quantity: 1,
      price_snapshot: 100,
    },
    {
      id: `i${id}c`,
      product_id: "c",
      product_variant_id: null,
      name_snapshot: "Снятое",
      quantity: 1,
      price_snapshot: 50,
    },
  ],
});
const talking = () => ({
  locale: "ru",
  direct: { last_reply: "Каталог", last_reply_at: new Date().toISOString() },
});

describe("«повторить» словом", () => {
  it("слова на четырёх языках — команда, обычная фраза — нет", () => {
    for (const w of ["повторить", "Как в прошлый раз", "қайталау", "reorder", "takrorlash"])
      expect(matchDirectCommand(w)).toBe("reorder");
    expect(matchDirectCommand("повторите цену")).toBeNull();
  });
});

describe("как в прошлый раз в Direct/WhatsApp", () => {
  it("товары в корзину по текущей цене, снятое названо; цена из старого заказа не копируется", async () => {
    const { say, sent, db } = setup({ locale: "ru" }, [paid(1)]);
    // Даже без разговора с ботом: слово про прошлый заказ — явная просьба.
    expect((await say("как в прошлый раз")).outcome).toBe("handled");
    expect(db.tables.cart_items!.map((c) => c.product_id)).toEqual(["a"]);
    const text = sent.join("\n");
    expect(text).toContain("Добавил в корзину 1 поз. из прошлого заказа");
    expect(text).toContain("Нет в наличии или стало меньше: Снятое.");
    // В корзину попадает только товар: цену она берёт из сегодняшнего каталога (200), а не из заказа (100).
    expect(db.tables.cart_items![0]).not.toHaveProperty("price");
    expect(db.tables.cart_items![0]).not.toHaveProperty("price_snapshot");
  });

  it("кнопка «повторить» (REORDER без номера) делает то же", async () => {
    const { say, db } = setup(talking(), [paid(1)]);
    await say("", "REORDER");
    expect(db.tables.cart_items).toHaveLength(1);
  });

  it("чужой заказ повторить нельзя: кнопка с чужим номером ничего не кладёт", async () => {
    const { say, db } = setup(talking(), [paid(5, -2)]);
    await say("", "REORDER:5");
    expect(db.tables.cart_items).toEqual([]);
    // а последний оплаченный берётся только свой
    await say("повторить");
    expect(db.tables.cart_items).toEqual([]);
  });

  it("нет оплаченного заказа: в разговоре с ботом — подсказка, в переписке с продавцом — молчим", async () => {
    const a = setup(talking(), [{ ...paid(1), status: "rejected" }]);
    await a.say("повторить");
    expect(a.sent).toEqual(["Прошлых оплаченных заказов пока нет — откройте каталог."]);
    const b = setup({ locale: "ru" }, []);
    expect((await b.say("повторить")).outcome).toBe("question");
    expect(b.sent).toEqual([]);
  });
});
