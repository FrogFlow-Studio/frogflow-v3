import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Действия продавца из панели пишут покупателю на его языке (З3). */
const notified: string[] = [];
const orders: Record<number, Record<string, unknown>> = {};
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  getOrder: async (_ctx: unknown, id: number) => orders[id] ?? null,
  rejectOrder: async () => true,
}));
vi.mock("./locale.server", () => ({ adminTFor: async () => (k: string) => k }));
vi.mock("@/core/storefront/web-notify", () => ({
  emailOrderNotice: async (_ctx: unknown, _o: unknown, text: string) => {
    notified.push(text);
    return true;
  },
}));
vi.mock("@/core/orders/physical-admin", () => ({
  acceptPhysicalOrder: async () => ({ ok: true, recorded: 0 }),
}));
vi.mock("@/core/orders/refund", () => ({
  refundOrder: async () => ({ ok: true, full: false, amount: 500, currency: "KZT" }),
}));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s" }) }));

const { runOrderAction, refundAndNotify } = await import("./admin.server");

function shop(locale: unknown, defaultLocale?: string) {
  const db = fakeDb();
  db.tables.bot_users = [{ user_key: "tg_5", telegram_id: 5, state: locale ? { locale } : {} }];
  return {
    db,
    ctx: {
      tenant: {
        id: "b",
        telegramTokenEnc: null,
        modules: {},
        settings: defaultLocale ? { default_locale: defaultLocale } : {},
      },
      db,
    } as unknown as TenantContext,
  };
}

const base = {
  id: 1,
  order_no: 7,
  display_no: 7,
  platform: "web",
  status: "awaiting_payment",
  total: 1000,
  currency: "KZT",
  fulfillment_kind: "physical",
  telegram_id: -3,
  user_key: "tg_5",
  customer_email: "a@b.kz",
  order_items: [],
};

describe("язык сообщений покупателю из админки", () => {
  it("kk-покупатель: отклонение и принятие в работу — по-казахски", async () => {
    const { ctx } = shop("kk");
    orders[1] = { ...base };
    notified.length = 0;
    await runOrderAction(ctx, 1, "reject");
    await runOrderAction(ctx, 1, "confirm");
    expect(notified).toEqual([
      "❌ #7 тапсырысты сатушы қабылдамады. Егер бұл қате болса — сатушыға жазыңыз.",
      "✅ #7 тапсырыс жұмысқа қабылданды.",
    ]);
  });

  it("возврат — на языке покупателя; без выбора — язык магазина", async () => {
    const kk = shop("kk");
    orders[1] = { ...base };
    notified.length = 0;
    await refundAndNotify(kk.ctx, 1, { amount: 500 });
    expect(notified[0]).toBe("↩️ #7 тапсырыс бойынша ішінара қайтарым рәсімделді: 500 KZT.");
    const en = shop(null, "en");
    notified.length = 0;
    await runOrderAction(en.ctx, 1, "reject");
    expect(notified[0]).toBe(
      "❌ Order #7 was declined by the seller. If this is a mistake, please message them.",
    );
  });

  it("смена статуса физического заказа — на языке покупателя", async () => {
    const { ctx, db } = shop("uz");
    orders[1] = { ...base, status: "accepted" };
    db.tables.orders = [{ id: 1, status: "accepted" }];
    notified.length = 0;
    await runOrderAction(ctx, 1, "next");
    expect(notified).toEqual(["🧑‍🍳 Buyurtma tayyorlanmoqda — #7"]);
  });

  it("kk-покупатель: «готовится» — по-казахски", async () => {
    const { ctx, db } = shop("kk");
    orders[1] = { ...base, status: "accepted" };
    db.tables.orders = [{ id: 1, status: "accepted" }];
    notified.length = 0;
    await runOrderAction(ctx, 1, "next");
    expect(notified).toEqual(["🧑‍🍳 Тапсырыс дайындалуда — #7"]);
  });
});
