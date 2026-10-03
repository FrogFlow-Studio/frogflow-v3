import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import { COPY } from "./copy";

/** Звёзды: ответ pre-checkout «заказ устарел» — на языке покупателя, а не магазина. */
vi.mock("@/core/payments/stars", async (orig) => ({
  ...(await orig<typeof import("@/core/payments/stars")>()),
  starsForOrder: async () => 200,
}));

const { handleTelegramUpdate } = await import("./handle-update");

const TG = 42;
let db: FakeDb;
let ctx: TenantContext;
let calls: Array<[string, Record<string, unknown>]>;
let api: TelegramApi;

beforeEach(() => {
  db = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: `tg_${TG}`,
      platform: "telegram",
      telegram_id: TG,
      state: { locale: "en", mode: "idle" },
    },
  ];
  // Заказ уже закрыт: Stars отклонит платёж и скажет об этом покупателю.
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      telegram_id: TG,
      user_key: `tg_${TG}`,
      status: "cancelled",
      fulfillment_kind: "digital",
      total: 1300,
      currency: "KZT",
    },
  ];
  db.tables.app_settings = [];
  ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: { telegram_stars: true },
      settings: { default_locale: "ru" },
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  calls = [];
  api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
});

describe("pre-checkout Stars", () => {
  it("отказ — текстом на языке покупателя (en), хотя язык магазина ru", async () => {
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      pre_checkout_query: {
        id: "q1",
        from: { id: TG, is_bot: false, first_name: "A" },
        currency: "XTR",
        total_amount: 200,
        invoice_payload: "order:7",
      },
    } as never);
    const answer = calls.find(([m]) => m === "answerPreCheckoutQuery")![1];
    expect(answer).toMatchObject({ ok: false, error_message: COPY.en.starsPaymentStale });
    expect(COPY.en.starsPaymentStale).not.toBe(COPY.ru.starsPaymentStale);
  });

  it("сбой чтения bot_users — ответ всё равно уходит, на языке магазина", async () => {
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      if (t !== "bot_users") return real(t);
      const failing: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit", "order", "maybeSingle", "single"])
        failing[m] = () => failing;
      failing.then = (ok: (v: unknown) => unknown) =>
        ok({ data: null, error: { message: "connection reset" } });
      return failing as never;
    }) as typeof db.from;
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      pre_checkout_query: {
        id: "q2",
        from: { id: TG, is_bot: false, first_name: "A" },
        currency: "XTR",
        total_amount: 200,
        invoice_payload: "order:7",
      },
    } as never);
    const answer = calls.find(([m]) => m === "answerPreCheckoutQuery")![1];
    expect(answer).toMatchObject({ ok: false, error_message: COPY.ru.starsPaymentStale });
  });
});
