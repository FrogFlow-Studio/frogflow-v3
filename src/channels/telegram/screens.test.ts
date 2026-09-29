import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramApi } from "./api";
import { resetOffersCache } from "@/core/offers/offers";

beforeEach(() => resetOffersCache());

/**
 * Что бот показывает покупателю: приветствие по /start, нижнее меню и
 * карточка товара — для нескольких наборов модулей и языков. Снимки
 * записаны до выноса этих экранов из обработчика (для предпросмотра в
 * админке) и после выноса обязаны совпасть байт в байт.
 */
const TG = 42;
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

function product(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    bot_id: "bot-1",
    name: "Пазл <мини> & ко",
    description: "Развивающий пазл\nдля детей 3+",
    price: 4990,
    currency: "KZT",
    is_active: true,
    fulfillment_kind: "digital",
    stock_quantity: null,
    lead_time_days: null,
    rating_avg: null,
    rating_count: 0,
    product_images: [],
    product_variants: [],
    product_material_files: [],
    ...over,
  };
}

function botFor(
  modules: Record<string, boolean>,
  opts: { locale?: string | null; defaultLocale?: string; vertical?: string } = {},
) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: opts.locale ? { locale: opts.locale } : {},
    },
  ];
  db.tables.app_settings = [
    { bot_id: "bot-1", key: "shop_name", value: "Лавка «Ёж» <1>" },
    // Акция −20% на товар с вариантами, без лимита и до далёкой даты.
    {
      bot_id: "bot-1",
      key: "limited_offers",
      value: JSON.stringify([
        {
          id: "o1",
          product_id: P2,
          percent: 20,
          starts_at: "2020-01-01T00:00:00Z",
          ends_at: "2099-12-31T18:00:00Z",
          limit: null,
        },
      ]),
    },
  ];
  db.tables.products = [
    product(P1, {
      product_images: [
        { image_path: "p/b.jpg", sort_order: 2 },
        { image_path: "p/a.jpg", sort_order: 1 },
      ],
      fulfillment_kind: "physical",
      lead_time_days: 3,
      rating_avg: 4.6,
      rating_count: 7,
    }),
    product(P2, {
      description: null,
      product_variants: [
        { id: "v2", name: "Большой", price: 7000, sort_order: 2 },
        { id: "v1", name: "Малый", price: 3000, sort_order: 1 },
      ],
    }),
    product(P3, { stock_quantity: 0 }),
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      name: "Имя из базы",
      slug: "ezh",
      status: "active",
      vertical: opts.vertical ?? "digital",
      modules,
      settings: { default_locale: opts.defaultLocale ?? "ru", served_by: "v2" },
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
  return { ctx, api, calls };
}

async function start(bot: ReturnType<typeof botFor>, payload = "") {
  await handleTelegramUpdate(bot.ctx, bot.api, {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: TG, type: "private" },
      from: { id: TG, first_name: "A" },
      text: payload ? `/start ${payload}` : "/start",
    },
  });
  return bot.calls
    .filter(([m]) => m === "sendMessage" || m === "sendPhoto")
    .map(([m, p]) => ({
      method: m,
      text: p.text ?? p.caption,
      photo: p.photo,
      reply_markup: p.reply_markup,
    }));
}

const MODULE_SETS: Record<string, Record<string, boolean>> = {
  base: {},
  legal_quiz: { legal_docs: true, quiz: true },
  mini_app: { telegram_mini_app: true, shop: true, legal_docs: true },
  mini_app_no_shop: { telegram_mini_app: true },
};

describe("приветствие и меню по /start", () => {
  for (const [name, modules] of Object.entries(MODULE_SETS))
    for (const locale of ["ru", "kk", "en", "uz"])
      it(`${name}, ${locale}`, async () => {
        expect(await start(botFor(modules, { defaultLocale: locale }))).toMatchSnapshot();
      });

  it("другая ниша (цветы)", async () => {
    expect(await start(botFor({ legal_docs: true }, { vertical: "flowers" }))).toMatchSnapshot();
  });

  it("несколько языков — сначала выбор языка", async () => {
    expect(await start(botFor({ multi_language: true }))).toMatchSnapshot();
  });
});

const CARD_MODULES: Record<string, Record<string, boolean>> = {
  base: {},
  full: { review_request: true, stock: true, waitlist: true, limited_offers: true },
  stock_only: { stock: true },
};

describe("карточка товара", () => {
  for (const [name, modules] of Object.entries(CARD_MODULES))
    for (const locale of ["ru", "en"])
      for (const [label, id] of [
        ["фото, срок изготовления, оценка", P1],
        ["варианты без описания", P2],
        ["нет в наличии", P3],
      ] as const)
        it(`${label}: ${name}, ${locale}`, async () => {
          expect(await start(botFor(modules, { locale }), `p_${id}`)).toMatchSnapshot();
        });
});

describe("главное меню онлайн-школы", () => {
  const base = { vertical: "courses", settings: {} };
  it("«Мои курсы» первой кнопкой, каталог — «Все курсы»", async () => {
    const { mainMenu } = await import("./screens");
    const menu = mainMenu(
      { ...base, modules: { courses: true, legal_docs: false } } as unknown as Tenant,
      "ru",
      "https://app.test",
    );
    expect(menu.keyboard[0]).toEqual([{ text: "🎓 Мои курсы" }]);
    expect(menu.keyboard[1]![0]!.text).toBe("📚 Все курсы");
    expect(menu.keyboard.flat().filter((b) => b.text === "🎓 Мои курсы")).toHaveLength(1);
  });
  it("«Все курсы» открывает каталог", async () => {
    const { menuActionFor } = await import("./copy");
    expect(menuActionFor("📚 Все курсы", [])).toBe("catalog");
  });
  it("не школа с модулем курсов — прежнее меню", async () => {
    const { mainMenu } = await import("./screens");
    const menu = mainMenu(
      { vertical: "digital", settings: {}, modules: { courses: true } } as unknown as Tenant,
      "ru",
      "https://app.test",
    );
    expect(menu.keyboard[0]![0]!.text).not.toBe("🎓 Мои курсы");
    expect(menu.keyboard.flat().some((b) => b.text === "🎓 Мои курсы")).toBe(true);
  });
});
