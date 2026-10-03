import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";

/**
 * /start w_<товар> с сайта: покупатель из Telegram встаёт в лист ожидания
 * товара без остатка; повторное нажатие не задваивает; товар в наличии —
 * просто карточка, в лист никто не записан.
 */
const TG = 42;
const OUT = "00000000-0000-4000-8000-000000000001";
const IN = "00000000-0000-4000-8000-000000000002";

const product = (id: string, stock: number | null) => ({
  id,
  bot_id: "bot-1",
  name: `Товар ${id.slice(-1)}`,
  description: "",
  price: 1000,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: 1,
  fulfillment_kind: "physical",
  stock_quantity: stock,
  category_ids: [],
  rating_count: 0,
  rating_avg: 0,
  created_at: "2026-01-01T00:00:00Z",
  product_images: [],
  product_variants: [],
  product_material_files: [],
});

function bot(modules: Record<string, boolean>) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      opt_out: false,
      state: { locale: "ru" },
    },
  ];
  db.tables.products = [product(OUT, 0), product(IN, 5)];
  db.tables.categories = [];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules,
      settings: { default_locale: "ru" },
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
  const start = (payload: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: TG, type: "private" },
        from: { id: TG, is_bot: false, first_name: "A" },
        text: `/start ${payload}`,
      },
    } as never);
  const texts = () =>
    calls
      .filter(([m]) => m === "sendMessage" || m === "sendPhoto")
      .map(([, p]) => String(p.text ?? p.caption));
  const waitlist = () => (db.tables.bot_users![0]!.state as { waitlist?: string[] }).waitlist ?? [];
  return { start, texts, waitlist };
}

describe("/start w_<товар> — лист ожидания с сайта", () => {
  it("товар без остатка: покупатель в листе, бот подтверждает", async () => {
    const b = bot({ waitlist: true, stock: true });
    await b.start(`w_${OUT}`);
    expect(b.waitlist()).toEqual([OUT]);
    expect(b.texts()).toContain(COPY.ru.waitlistJoined);
  });

  it("повторное нажатие не задваивает запись", async () => {
    const b = bot({ waitlist: true, stock: true });
    await b.start(`w_${OUT}`);
    await b.start(`w_${OUT}`);
    expect(b.waitlist()).toEqual([OUT]);
  });

  it("товар в наличии: карточка, в листе пусто", async () => {
    const b = bot({ waitlist: true, stock: true });
    await b.start(`w_${IN}`);
    expect(b.waitlist()).toEqual([]);
    expect(b.texts().join("\n")).not.toContain(COPY.ru.waitlistJoined);
    expect(b.texts().join("\n")).toContain("Товар 2");
  });

  it("без модуля waitlist ссылка никого не записывает", async () => {
    const b = bot({ stock: true });
    await b.start(`w_${OUT}`);
    expect(b.waitlist()).toEqual([]);
  });
});
