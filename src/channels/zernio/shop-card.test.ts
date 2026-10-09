import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";

/**
 * Карточка товара в Instagram/WhatsApp Direct на фейковой базе: что уходит
 * покупателю — текст и кнопки — видно через подменённый транспорт.
 */
const P = "33333333-3333-3333-3333-333333333333";

function shopFor(product: Record<string, unknown>, modules: Record<string, boolean>) {
  const db = fakeDb();
  db.tables.bot_users = [{ user_key: "ig_1", platform: "whatsapp", telegram_id: -1, state: {} }];
  db.tables.products = [
    {
      id: P,
      name: "Торт «Прага»",
      description: null,
      price: 12000,
      currency: "KZT",
      is_active: true,
      fulfillment_kind: "physical",
      stock_quantity: 0,
      lead_time_days: null,
      product_images: [],
      product_variants: [],
      product_material_files: [],
      ...product,
    },
  ];
  const ctx = {
    tenant: { id: "bot-1", status: "active", vertical: "digital", modules, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: Array<{ text: string; buttons: Array<{ payload?: string }> }> = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string, o: { buttons?: [] } = {}) => {
      sent.push({ text, buttons: o.buttons ?? [] });
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "ig_1",
    platform: "whatsapp",
    telegramId: -1,
    state: { locale: "ru", mode: "idle" },
  } as unknown as Customer;
  // Через WhatsApp: в Instagram PROD:… — кнопка «Купить», товар сразу идёт в корзину.
  const open = () =>
    handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "conv-1",
        accountId: "acc-1",
        platform: "whatsapp",
        text: "",
        postbackPayload: `PROD:${P}`,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  return { open, sent, db };
}

const payloads = (b: Array<{ payload?: string }>) => b.map((x) => x.payload ?? "");

describe("Direct: карточка товара без остатка", () => {
  it("прячет кнопки покупки у товара без остатка, у товара в наличии — показывает", async () => {
    const out = shopFor({}, { stock: true });
    await out.open();
    const card = out.sent.at(-1)!;
    expect(payloads(card.buttons).some((p) => p.startsWith("BUY:"))).toBe(false);
    expect(card.text).toContain("Прага");

    const withVariants = (stock: number) =>
      shopFor(
        {
          stock_quantity: stock,
          product_variants: [
            { id: "v1", name: "1 кг", price: 12000, sort_order: 0 },
            { id: "v2", name: "2 кг", price: 20000, sort_order: 1 },
          ],
        },
        { stock: true },
      );
    const variantsOut = withVariants(0);
    await variantsOut.open();
    expect(payloads(variantsOut.sent.at(-1)!.buttons).some((p) => p.startsWith("BUY:"))).toBe(
      false,
    );
    const variantsIn = withVariants(3);
    await variantsIn.open();
    expect(payloads(variantsIn.sent.at(-1)!.buttons)).toContain(`BUY:${P}:v1`);

    const inStock = shopFor({ stock_quantity: 5 }, { stock: true });
    await inStock.open();
    expect(payloads(inStock.sent.at(-1)!.buttons)).toContain(`BUY:${P}`);
  });
});

describe("Direct: рейтинг на карточке товара", () => {
  it("считает только одобренные отзывы: скрытый «1 ⭐» в рейтинг не идёт", async () => {
    // Колонки products.rating_* считают все отзывы подряд: 4 оценки, среднее 3.5.
    const out = shopFor(
      { stock_quantity: 5, rating_avg: 3.5, rating_count: 4 },
      { review_request: true },
    );
    const stars = [5, 5, 3, 1];
    out.db.tables.product_reviews = stars.map((rating, i) => ({
      id: `r-${i}`,
      product_id: P,
      telegram_id: 10 + i,
      rating,
    }));
    out.db.tables.app_settings = stars.map((_, i) => ({
      bot_id: "bot-1",
      key: `review_meta:r-${i}`,
      value: JSON.stringify({ status: i === 3 ? "hidden" : "approved", photos: [] }),
    }));
    await out.open();
    const text = out.sent.at(-1)!.text;
    expect(text).toContain("4.3 (3)");
    expect(text).not.toContain("3.5");
  });
});
