import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Оформление на сайте: заблокированный продавцом покупатель заказ не
 * оформляет. createServerFn зовёт обработчик напрямую; задача для браузера,
 * лимиты и само оформление подменены, проверка блокировки — настоящая.
 */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s".repeat(32) }) }));
vi.mock("@/app/signup/challenge", () => ({
  verifyChallenge: () => null,
  challengeNonce: () => "nonce",
  CHALLENGE_TOO_FAST: "fast",
  POW_BITS: 1,
}));
vi.mock("@/app/auth/login-guard.server", () => ({ clientIp: () => "1.2.3.4" }));
vi.mock("@/core/storefront/checkout-guard", () => ({
  takeWeb: async () => true,
  claimCheckoutChallenge: async () => "ok",
}));
const placeWebOrder = vi.fn(async () => ({
  ok: true,
  order: { id: 5 },
  zeroTotal: false,
  amountDue: 100,
}));
vi.mock("@/core/storefront/web-order", async (orig) => ({
  ...(await orig<typeof import("@/core/storefront/web-order")>()),
  webCheckoutSettings: async () => ({ enabled: true, tgLogin: false }),
  webCustomer: async () => ({ userKey: "web_abc", telegramId: -777, platform: "web", state: {} }),
  telegramWebCustomer: async (_ctx: unknown, id: number) => ({
    userKey: `tg:${id}`,
    telegramId: id,
    platform: "web",
    state: {},
  }),
  placeWebOrder: (...a: unknown[]) => placeWebOrder(...(a as [])),
}));
let loggedInTg: number | null = null;
vi.mock("./tg-login.server", () => ({ buyerTelegramId: async () => loggedInTg }));
vi.mock("@/channels/web/order.server", () => ({ afterWebOrderPlaced: async () => {} }));

const BOT = "11111111-1111-1111-1111-111111111111";
let ctx: TenantContext;
let db: FakeDb;
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ctx.tenant,
  tenantContext: () => ctx,
}));

const { webCheckoutFn } = await import("./checkout.functions");

const input = {
  slug: "shop",
  items: [{ product_id: "aaaaaaaa-0000-4000-8000-000000000000", quantity: 1 }],
  name: "Анна",
  email: "anna@example.com",
  country: "KZ",
  challenge: "c",
  answer: "a",
};

beforeEach(() => {
  placeWebOrder.mockClear();
  loggedInTg = null;
  db = fakeDb();
  db.tables.blocked_users = [];
  ctx = {
    tenant: {
      id: BOT,
      status: "active",
      archived: false,
      modules: { shop: true, web_storefront: true, blocked: true },
      settings: { served_by: "v2", slug: "shop", default_locale: "ru" },
    },
    db,
  } as unknown as TenantContext;
});

describe("оформление на сайте: заблокированный покупатель", () => {
  it("заказ не создаётся; отказ нейтральный", async () => {
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: -777 }];
    const err = await webCheckoutFn({ data: input }).catch((e: Error) => e.message);
    expect(err).toBe("Оформить заказ сейчас нельзя. Свяжитесь с магазином.");
    expect(placeWebOrder).not.toHaveBeenCalled();
  });

  it("не заблокирован — оформление идёт как обычно", async () => {
    const r = await webCheckoutFn({ data: input });
    expect(r).toMatchObject({ id: 5 });
    expect(placeWebOrder).toHaveBeenCalledTimes(1);
  });

  it("без модуля блокировок список не действует, как в боте", async () => {
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: -777 }];
    (ctx.tenant.modules as Record<string, boolean>).blocked = false;
    await expect(webCheckoutFn({ data: input })).resolves.toMatchObject({ id: 5 });
  });

  it("вошёл через Telegram — проверяется его id из бота", async () => {
    loggedInTg = 4242;
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 4242 }];
    const err = await webCheckoutFn({ data: input }).catch((e: Error) => e.message);
    expect(err).toBe("Оформить заказ сейчас нельзя. Свяжитесь с магазином.");
    expect(placeWebOrder).not.toHaveBeenCalled();
  });
});

describe("оформление на сайте: согласие с офертой", () => {
  const legal = () => {
    (ctx.tenant.modules as Record<string, boolean>).legal_docs = true;
    db.tables.app_settings = [
      { bot_id: BOT, key: "legal_offer", value: "Оферта школы" },
      { bot_id: BOT, key: "legal_privacy", value: "Политика" },
    ];
  };

  it("оферта опубликована — без галочки заказ не создаётся", async () => {
    legal();
    const err = await webCheckoutFn({ data: input }).catch((e: Error) => e.message);
    expect(err).toBe("Отметьте согласие с условиями, чтобы оформить заказ.");
    expect(placeWebOrder).not.toHaveBeenCalled();
  });

  it("с галочкой — заказ создан, в истории заказа — принятые документы", async () => {
    legal();
    await expect(webCheckoutFn({ data: { ...input, consent: true } })).resolves.toMatchObject({
      id: 5,
    });
    const ev = (db.tables.zernio_logs ?? []).find(
      (r) => (r as { event_type?: string }).event_type === "order.consent",
    ) as { payload?: Record<string, unknown> } | undefined;
    expect(ev?.payload).toMatchObject({ offer: true, privacy: true });
  });

  it("документов нет — галочки нет, оформление как раньше", async () => {
    (ctx.tenant.modules as Record<string, boolean>).legal_docs = true;
    await expect(webCheckoutFn({ data: input })).resolves.toMatchObject({ id: 5 });
  });
});
