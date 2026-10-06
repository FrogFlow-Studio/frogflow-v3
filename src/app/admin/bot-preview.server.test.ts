import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import type { TelegramApi } from "@/channels/telegram/api";
import { resetOffersCache } from "@/core/offers/offers";
import { botPreview } from "./bot-preview.server";

/**
 * Предпросмотр показывает ровно то, что бот отправил бы покупателю, и
 * ничего не пишет в базу.
 */
const TG = 42;
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function setup(modules: Record<string, boolean>) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: {},
    },
  ];
  db.tables.app_settings = [{ bot_id: "bot-1", key: "shop_name", value: "Лавка <Ёж>" }];
  const product = (id: string, name: string, sort_order: number, over = {}) => ({
    id,
    bot_id: "bot-1",
    name,
    description: "Описание",
    price: 1000,
    currency: "KZT",
    is_active: true,
    sort_order,
    fulfillment_kind: "digital",
    stock_quantity: null,
    rating_count: 0,
    product_images: [{ image_path: "p/a.jpg", sort_order: 1 }],
    product_variants: [],
    product_material_files: [],
    ...over,
  });
  db.tables.products = [
    product(P2, "Второй", 2),
    product(P1, "Первый", 1, { stock_quantity: 0 }),
    product("33333333-3333-4333-8333-333333333333", "Скрытый", 0, { is_active: false }),
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      name: "Имя",
      status: "active",
      vertical: "digital",
      modules,
      settings: { default_locale: "kk", served_by: "v2" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  return { ctx, db, api, calls };
}

async function botSends(s: ReturnType<typeof setup>, text: string) {
  s.calls.length = 0;
  await handleTelegramUpdate(s.ctx, s.api, {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: TG, type: "private" },
      from: { id: TG, first_name: "A" },
      text,
    },
  });
  return s.calls.filter(([m]) => m === "sendMessage" || m === "sendPhoto").map(([, p]) => p);
}

beforeEach(() => resetOffersCache());

describe("предпросмотр бота", () => {
  it("приветствие, меню и карточка совпадают с тем, что шлёт бот", async () => {
    const s = setup({ legal_docs: true, quiz: true, stock: true, waitlist: true });
    const snapshot = JSON.stringify(s.db.tables);
    const view = await botPreview(s.ctx, {});
    // Предпросмотр только читает.
    expect(JSON.stringify(s.db.tables)).toBe(snapshot);

    const [welcome] = await botSends(s, "/start");
    expect(view.locale).toBe("kk");
    expect(view.welcome).toBe(welcome!.text);
    expect(view.menu).toEqual(welcome!.reply_markup);
    expect(view.languageChoice).toBeNull();

    // Первый по порядку активный товар — «Первый», его нет в наличии.
    const [card] = await botSends(s, `/start p_${P1}`);
    expect(view.product!.id).toBe(P1);
    expect(view.product!.caption.slice(0, 1024)).toBe(card!.caption);
    expect(view.product!.photo).toBe(card!.photo);
    expect(view.product!.keyboard).toEqual(card!.reply_markup);
  });

  it("выбранный товар и язык; язык вне списка — язык по умолчанию", async () => {
    const s = setup({});
    const v = await botPreview(s.ctx, { locale: "en", productId: P2 });
    expect(v.locale).toBe("kk");
    expect(v.locales).toEqual(["kk"]);
    expect(v.product!.name).toBe("Второй");
  });

  it("несколько языков: вопрос о языке и меню на выбранном", async () => {
    const s = setup({ multi_language: true });
    const v = await botPreview(s.ctx, { locale: "en" });
    expect(v.locales).toEqual(["ru", "kk", "en", "uz"]);
    expect(v.languageChoice!.buttons.flat().map((b) => b.callback_data)).toEqual([
      "locale:ru",
      "locale:kk",
      "locale:en",
      "locale:uz",
    ]);
    expect(v.menu.keyboard[0]![0]!.text).toBe("📚 Catalog");
  });

  it("консультант без товаров (BOVI): меню без каталога и корзины — как шлёт бот", async () => {
    const s = setup({ shop: true, dm_shop: true });
    (s.ctx.tenant as { vertical: string }).vertical = "consultant";
    s.db.tables.products = [];
    const view = await botPreview(s.ctx, {});
    const [welcome] = await botSends(s, "/start");
    expect(view.menu).toEqual(welcome!.reply_markup);
    const texts = JSON.stringify(view.menu);
    expect(texts).not.toContain("📚");
    expect(texts).not.toContain("🛒");
  });

  it("скрытый товар в предпросмотр не попадает", async () => {
    const s = setup({});
    const v = await botPreview(s.ctx, { productId: "33333333-3333-4333-8333-333333333333" });
    expect(v.product).toBeNull();
  });
});
