import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import type { TelegramApi } from "./api";

/**
 * Оплата остатка по задатку в боте: кнопка в «Моих заказах», сумма и
 * реквизиты, карта, если Robokassa подключена, и чек на остаток.
 */
const uploaded: string[] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploaded.push(key);
          return { data: {}, error: null };
        },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }),
}));
const proofNotices: Array<{ orderId: number; due: number }> = [];
vi.mock("./notify", async (orig) => ({
  ...(await orig<typeof import("./notify")>()),
  notifyBalanceProof: async (_c: unknown, o: { id: number }, due: number) =>
    void proofNotices.push({ orderId: o.id, due }),
}));
let rkReady = false;
vi.mock("@/core/payments/payment", async (orig) => ({
  ...(await orig<typeof import("@/core/payments/payment")>()),
  robokassaFor: async () => ({ ready: rkReady }),
}));
vi.mock("@/core/payments/robokassa", async (orig) => ({
  ...(await orig<typeof import("@/core/payments/robokassa")>()),
  buildPaymentUrl: (_rk: unknown, p: { invId: number; outSum: number }) =>
    `https://rk.test/pay?inv=${p.invId}&sum=${p.outSum}`,
}));

const { handleTelegramUpdate } = await import("./handle-update");

const TG = 42;
let db: FakeDb;
let ctx: TenantContext;
let calls: Array<[string, Record<string, unknown>]>;
let api: TelegramApi;
const from = { id: TG, is_bot: false, first_name: "A" };

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale: "ru", mode: "idle" },
    },
  ];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      telegram_id: TG,
      status: "in_production",
      fulfillment_kind: "physical",
      total: 10000,
      paid_amount: 3000,
      currency: "KZT",
      country_code: "KZ",
      created_at: "2026-09-20T10:00:00Z",
      payment_proof_hash: "deposit",
      order_items: [{ name_snapshot: "Торт", quantity: 1 }],
    },
  ];
  db.tables.payment_methods = [
    {
      id: "pm",
      country_code: "KZ",
      country_name: "Казахстан",
      is_active: true,
      sort_order: 1,
      instructions: "Kaspi 8 700 000 00 00",
    },
  ];
  db.tables.zernio_logs = [];
  db.tables.app_settings = [];
  ctx = {
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
  calls = [];
  api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      if (method === "getFile") return { ok: true, result: { file_path: "photos/1.jpg" } };
      return { ok: true, result: {} };
    }),
    fileUrl: (p: string) => `https://tg.test/file/${p}`,
  } as unknown as TelegramApi;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), {
          headers: { "content-type": "image/jpeg" },
        }),
    ),
  );
  uploaded.length = 0;
  proofNotices.length = 0;
  rkReady = false;
});
afterEach(() => vi.unstubAllGlobals());

const text = (t: string) =>
  ({
    update_id: 1,
    message: { message_id: 1, date: 0, chat: { id: TG, type: "private" }, from, text: t },
  }) as never;
const press = (data: string) =>
  ({
    update_id: 2,
    callback_query: {
      id: "cq",
      from,
      data,
      message: { message_id: 5, date: 0, chat: { id: TG, type: "private" } },
    },
  }) as never;
const photo = () =>
  ({
    update_id: 3,
    message: {
      message_id: 2,
      date: 0,
      chat: { id: TG, type: "private" },
      from,
      photo: [{ file_id: "f1", file_unique_id: "u1", width: 1, height: 1 }],
    },
  }) as never;
const sent = () => calls.filter(([m]) => m === "sendMessage").map(([, p]) => String(p.text));
const lastButtons = () => {
  const p = calls.filter(([m]) => m === "sendMessage").pop()?.[1];
  const kb = (
    p?.reply_markup as {
      inline_keyboard?: Array<Array<{ callback_data?: string; url?: string }>>;
    }
  )?.inline_keyboard;
  return (kb ?? []).flat();
};
const state = () => db.tables.bot_users![0]!.state as Record<string, unknown>;

describe("оплата остатка в боте", () => {
  it("«Мои заказы»: у заказа в работе с задатком — кнопка «Оплатить остаток»", async () => {
    await handleTelegramUpdate(ctx, api, text("📋 Мои заказы"));
    expect(lastButtons().map((b) => b.callback_data)).toContain("balance:7");
  });

  it("кнопка: сумма с сервера и реквизиты, без Robokassa — без карты; бот ждёт чек", async () => {
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    const msg = sent().pop()!;
    expect(msg).toContain("Остаток по заказу #7");
    expect(msg).toMatch(/7\s?000/);
    expect(msg).toContain("Kaspi 8 700 000 00 00");
    expect(lastButtons().some((b) => b.url)).toBe(false);
    expect(state()).toMatchObject({ mode: "awaiting_balance_proof", pending_order_id: 7 });
  });

  it("Robokassa подключена — кнопка карты со своим номером счёта на каждую ссылку", async () => {
    rkReady = true;
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    const first = lastButtons().find((b) => b.url)!.url!;
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    const second = lastButtons().find((b) => b.url)!.url!;
    expect(first).toContain("inv=1000000000070000");
    expect(second).toContain("inv=1000000000070001");
    expect(first).toContain("sum=7000");
  });

  it("чек на остаток: принят, продавцу — уведомление; второй раз оплатить нельзя, пока чек на проверке", async () => {
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    await handleTelegramUpdate(ctx, api, photo());
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatch(/^bot-1\/order-7\/balance-/);
    expect(sent().pop()).toContain("Чек на остаток по заказу #7 получен");
    expect(proofNotices).toEqual([{ orderId: 7, due: 7000 }]);
    expect(state().mode).toBe("idle");
    // Кнопки в «Моих заказах» больше нет, а старая — отвечает «на проверке».
    await handleTelegramUpdate(ctx, api, text("📋 Мои заказы"));
    expect(lastButtons().map((b) => b.callback_data)).not.toContain("balance:7");
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    expect(sent().pop()).toContain("уже у продавца на проверке");
  });

  it("остаток уже внесён — «доплачивать нечего», чек не принимается", async () => {
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    db.tables.orders![0]!.paid_amount = 10000;
    await handleTelegramUpdate(ctx, api, photo());
    expect(uploaded).toHaveLength(0);
    expect(sent().pop()).toContain("доплачивать нечего");
  });

  it("чужой заказ по кнопке — ничего не показываем", async () => {
    db.tables.orders![0]!.telegram_id = 999;
    await handleTelegramUpdate(ctx, api, press("balance:7"));
    expect(sent()).toHaveLength(0);
  });
});
