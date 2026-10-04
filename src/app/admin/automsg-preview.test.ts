import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => ({
    call: async (method: string, body: Record<string, unknown>) => {
      calls.push({ method, body });
      return { ok: true };
    },
  }),
}));
const { buildPreview, sendPreviewToSeller } = await import("./automsg-preview.server");
const { winbackText, parseWinback } = await import("@/core/winback/winback");
const { cartReminderBody } = await import("@/channels/telegram/copy");

function setup(buyers: Array<Record<string, unknown>> = []) {
  const db = fakeDb();
  db.tables.app_settings = [{ key: "admin_chat_id", value: "555" }];
  db.tables.bot_users = buyers;
  db.tables.products = [
    { id: "p1", name: "Торт", price: 5000, currency: "KZT", is_active: true, sort_order: 1 },
    { id: "p2", name: "Эклер", price: 700, currency: "KZT", is_active: true, sort_order: 2 },
    { id: "p3", name: "Снятый", price: 1, currency: "KZT", is_active: false, sort_order: 0 },
  ];
  const ctx = {
    tenant: { id: "b", modules: {}, settings: { default_locale: "en" }, ownerTelegramId: null },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("предпросмотр автосообщений", () => {
  it("возврат: правки формы и имя реального покупателя, как в рассылке", async () => {
    const { ctx } = setup([
      { user_key: "tg_1", platform: "telegram", first_name: "Мадина", created_at: "2026-10-01" },
    ]);
    const draft = { enabled: true, days1: 30, text1: "{name}, скидка {promo}", promo: "back" };
    const p = await buildPreview(ctx, "winback", draft);
    expect(p.buyer).toBe("Мадина");
    expect(p.texts).toEqual([winbackText(parseWinback(JSON.stringify(draft)), 1, "Мадина")]);
    expect(p.texts[0]).toBe("Мадина, скидка BACK");
  });

  it("покупателей нет — выдуманный образец, buyer = null", async () => {
    const { ctx } = setup();
    const p = await buildPreview(ctx, "winback");
    expect(p.buyer).toBeNull();
    expect(p.texts[0]).toContain("Анна");
  });

  it("корзина: текст на языке магазина из той же функции, что шлёт крон; снятые товары не берутся", async () => {
    const { ctx } = setup();
    const p = await buildPreview(ctx, "cart");
    expect(p.locale).toBe("en");
    expect(p.texts).toEqual([
      cartReminderBody(
        "en",
        [
          { name: "Торт", quantity: 2 },
          { name: "Эклер", quantity: 1 },
        ],
        0,
        "10700 ₸",
      ),
    ]);
    expect(p.texts[0]).not.toContain("Снятый");
  });

  it("«отправить себе» уходит продавцу и не трогает state покупателей", async () => {
    const buyer = {
      user_key: "tg_1",
      platform: "telegram",
      first_name: "Мадина",
      created_at: "2026-10-01",
      state: { last_marketing_at: "x", marketing_times: ["x"] },
      cart_reminder_sent_at: null,
    };
    const { db, ctx } = setup([buyer]);
    const before = JSON.stringify(db.tables.bot_users);
    calls.length = 0;
    const p = await buildPreview(ctx, "similar");
    expect(await sendPreviewToSeller(ctx, p, "Пример")).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.chat_id).toBe("555");
    expect(JSON.stringify(db.tables.bot_users)).toBe(before);
  });
});
