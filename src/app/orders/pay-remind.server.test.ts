import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

const buyer = vi.fn();
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "secret" }) }));
vi.mock("@/core/storefront/web-order", () => ({
  orderPageUrl: async (
    c: { tenant: { id: string; settings: { slug?: string } }; appUrl: string },
    id: number,
  ) => `${c.appUrl}/s/${c.tenant.settings.slug}/order/${id}?t=tok-${c.tenant.id}-${id}`,
}));
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: (...a: unknown[]) => buyer(...a),
}));

const { reminderText } = await import("./pay-remind.server");

const ctx = {
  tenant: { id: "b", settings: { default_locale: "ru", slug: "propisi" } },
  appUrl: "https://shop.test",
} as unknown as TenantContext;
const base = {
  orderId: 9,
  no: 501,
  telegramId: 42,
  due: 2500,
  total: 2500,
  currency: "KZT",
  instructions: "Kaspi <8 700> & Co",
  invoiceLink: false,
};

describe("текст напоминания об оплате", () => {
  it("Telegram: HTML, реквизиты экранированы, просьба прислать чек", async () => {
    buyer.mockResolvedValue({ state: {} });
    const t = await reminderText(ctx, { ...base, platform: "telegram" });
    expect(t).toContain("<b>Заказ #501 ждёт оплаты</b>");
    expect(t).toContain("Kaspi &lt;8 700&gt; &amp; Co");
    expect(t).toContain("пришлите сюда фото или PDF чека");
  });

  it("Instagram: без тегов, реквизиты как есть; задаток — отдельной строкой", async () => {
    buyer.mockResolvedValue({ state: {} });
    const t = await reminderText(ctx, { ...base, platform: "instagram", due: 1000, total: 4000 });
    expect(t).not.toMatch(/<\/?b>/);
    expect(t).toContain("Kaspi <8 700> & Co");
    expect(t).toContain("задаток");
  });

  it("язык покупателя; нет реквизитов — «уточните у продавца»", async () => {
    buyer.mockResolvedValue({ state: { locale: "en" } });
    const t = await reminderText(ctx, { ...base, platform: "telegram", instructions: null });
    expect(t).toContain("Order #501 is awaiting payment");
    expect(t).toContain("Please ask the seller for payment details.");
  });

  it("счёт ссылкой: вместо реквизитов — ссылка на страницу заказа", async () => {
    buyer.mockResolvedValue({ state: {} });
    const t = await reminderText(ctx, {
      ...base,
      platform: "instagram",
      instructions: null,
      invoiceLink: true,
    });
    expect(t).toContain("https://shop.test/s/propisi/order/9?t=tok-b-9");
    expect(t).not.toContain("Kaspi");
    expect(t).not.toContain("пришлите сюда");
  });
});
