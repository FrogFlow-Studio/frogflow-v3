import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate, isFreeTextQuery } from "./handle-update";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";

/** Б7: любой текст вне шага — поиск по словам, с опечаткой в одну букву. */
const TG = 42;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const product = (n: number, name: string) => ({
  id: uid(n),
  bot_id: "bot-1",
  name,
  keywords: null,
  description: "",
  price: 1000,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: n,
  fulfillment_kind: "physical",
  stock_quantity: 5,
  category_ids: [],
  rating_count: 0,
  rating_avg: 0,
  created_at: "2026-01-01T00:00:00Z",
  product_images: [],
  product_variants: [],
  product_material_files: [],
});

function bot(names: string[], mode?: string) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      opt_out: false,
      state: { locale: "ru", ...(mode ? { mode } : {}) },
    },
  ];
  db.tables.products = names.map((n, i) => product(i + 1, n));
  db.tables.product_variants = [];
  db.tables.categories = [];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: {},
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
  const say = (text: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: TG, type: "private" },
        from: { id: TG, is_bot: false, first_name: "A" },
        text,
      },
    } as never);
  const last = () => calls.filter(([m]) => m === "sendMessage").at(-1)![1];
  const buttons = () =>
    (
      (last().reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] })
        ?.inline_keyboard ?? []
    ).flat();
  return { say, last, buttons, calls };
}

beforeEach(() => setEnvForTests({}));
afterEach(() => setEnvForTests(undefined));

describe("isFreeTextQuery", () => {
  it("команда, пустое и слишком длинное — не запрос", () => {
    expect(isFreeTextQuery("/start")).toBe(false);
    expect(isFreeTextQuery("а")).toBe(false);
    expect(isFreeTextQuery("x".repeat(81))).toBe(false);
    expect(isFreeTextQuery("прописи")).toBe(true);
  });
});

describe("поиск в Telegram свободным текстом", () => {
  it("слово вне шага — товары кнопками", async () => {
    const b = bot(["Прописи цифры", "Прописи буквы", "Футболка"]);
    await b.say("прописи");
    expect(b.buttons().map((x) => x.text)).toEqual(["Прописи цифры", "Прописи буквы"]);
    expect(b.buttons().every((x) => x.callback_data.startsWith("prod:"))).toBe(true);
  });

  it("опечатка в одну букву находит", async () => {
    const b = bot(["Прописи цифры", "Футболка"]);
    await b.say("прэписи");
    expect(b.buttons().map((x) => x.text)).toEqual(["Прописи цифры"]);
  });

  it("не больше 8 кнопок и «Показать ещё», если есть остальные", async () => {
    const b = bot(Array.from({ length: 12 }, (_, i) => `Прописи ${i + 1}`));
    await b.say("прописи");
    const btns = b.buttons();
    expect(btns).toHaveLength(9);
    expect(btns.slice(0, 8).every((x) => x.callback_data.startsWith("prod:"))).toBe(true);
    expect(btns[8]!.callback_data).toBe("searchmore:8");
  });

  it("пустой результат — «ничего не найдено» и кнопка «Каталог»", async () => {
    const b = bot(["Прописи цифры"]);
    await b.say("ботинки");
    expect(String(b.last().text)).toBe(COPY.ru.searchNothing("ботинки"));
    expect(b.buttons()).toEqual([{ text: COPY.ru.catalog, callback_data: "cat:root" }]);
  });

  it("в режиме «Поиск» работает так же, с опечаткой", async () => {
    const b = bot(["Прописи цифры"], "search");
    await b.say("прэписи");
    expect(JSON.stringify(b.calls)).toContain("Прописи цифры");
    expect(b.buttons().map((x) => x.text)).toContain(COPY.ru.addToCartBtn);
  });
});
