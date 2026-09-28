import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { completeLanguageDelivery } from "./orders";

// Кнопка выбора языка файла приходит от покупателя — её можно подделать.
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";

function shop(order: Record<string, unknown>, delivered: string | null) {
  const db = fakeDb();
  db.tables.orders = [
    {
      id: 7,
      bot_id: BOT,
      telegram_id: 55,
      status: "delivering",
      total: 1000,
      currency: "KZT",
      delivery_lang_choice: null,
      ...order,
    },
  ];
  db.tables.order_items = [
    {
      id: "it1",
      order_id: 7,
      name_snapshot: "Прописи",
      delivered_language: delivered,
      material_files_by_lang: {
        ru: [{ path: `${BOT}/ru.pdf`, name: "ru.pdf" }],
        kk: [{ path: `${BOT}/kk.pdf`, name: "kk.pdf" }],
      },
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { multi_language: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return ctx;
}

const pick = (ctx: TenantContext, lang: "ru" | "kk", send = vi.fn(async () => "sent" as const)) =>
  completeLanguageDelivery(ctx, { orderId: 7, itemId: "it1", lang, telegramId: 55 }, send);

describe("выбор языка файла", () => {
  it("неоплаченный, отклонённый или возвращённый заказ — файлов нет", async () => {
    for (const status of ["awaiting_payment", "awaiting_confirmation", "rejected", "refunded"]) {
      const send = vi.fn(async () => "sent" as const);
      expect((await pick(shop({ status }, null), "ru", send)).status).toBe("not_found");
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("оплачен один язык — второй по кнопке не выдаётся", async () => {
    const send = vi.fn(async () => "sent" as const);
    expect((await pick(shop({}, "ru"), "kk", send)).status).toBe("already");
    expect((await pick(shop({ status: "delivered" }, "ru"), "kk", send)).status).toBe("already");
    expect(send).not.toHaveBeenCalled();
  });

  it("чужой покупатель — как нет заказа", async () => {
    const ctx = shop({ telegram_id: 99 }, null);
    expect((await pick(ctx, "ru")).status).toBe("not_found");
  });
});
