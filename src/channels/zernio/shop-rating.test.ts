import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";
import { COPY } from "@/channels/telegram/copy";

/** Ответ цифрой на просьбу об оценке (core/reviews/ask) в Instagram/WhatsApp. */
const P1 = "a0000000-0000-4000-8000-000000000001";

function shopFor(opts: {
  platform?: "instagram" | "whatsapp";
  askedMinutesAgo?: number;
  bought?: boolean;
  /** Товары заказа (по умолчанию один: P1). */
  items?: Array<{ id: string; name: string }>;
}) {
  const platform = opts.platform ?? "instagram";
  const asked = new Date(Date.now() - (opts.askedMinutesAgo ?? 30) * 60_000).toISOString();
  const state = {
    locale: "ru",
    mode: "awaiting_rating",
    review_product_id: opts.items?.[0]?.id ?? P1,
    review_order_id: 5,
    review_ask_at: asked,
  };
  const db = fakeDb();
  db.tables.bot_users = [{ user_key: "ig_1", platform, telegram_id: -1, loyalty_points: 0, state }];
  db.tables.app_settings = [];
  db.tables.product_reviews = [];
  db.tables.orders = [
    { id: 5, telegram_id: -1, status: opts.bought === false ? "paid" : "delivered" },
  ];
  db.tables.order_items = (opts.items ?? [{ id: P1, name: "Прописи" }]).map((i) => ({
    order_id: 5,
    product_id: i.id,
    name_snapshot: i.name,
  }));
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: { review_request: true },
      settings: {},
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "ig_1",
    platform,
    telegramId: -1,
    loyaltyPoints: 0,
    state,
  } as unknown as Customer;
  // Как в бою: каждая реплика приходит с состоянием, записанным в базу предыдущей.
  const say = (text: string) => {
    customer.state = db.tables.bot_users![0]!.state as Customer["state"];
    return handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "conv-1",
        accountId: "acc-1",
        platform,
        text,
        postbackPayload: null,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  };
  const mode = () => (db.tables.bot_users![0]!.state as Record<string, unknown>).mode;
  return { db, say, sent, mode };
}

describe("Direct/WhatsApp: ответ цифрой на просьбу об оценке", () => {
  for (const platform of ["instagram", "whatsapp"] as const)
    it(`${platform}: «5» сохраняет оценку тем же saveRating и благодарит`, async () => {
      const t = shopFor({ platform });
      const r = await t.say("5");
      expect(r.outcome).toBe("handled");
      expect(t.db.tables.product_reviews).toMatchObject([
        { telegram_id: -1, product_id: P1, rating: 5 },
      ]);
      expect(t.sent).toEqual([COPY.ru.ratingThanks.replace(/<[^>]+>/g, "")]);
      expect(t.mode()).toBe("idle");
    });

  it("заказ из трёх товаров: три оценки по очереди, каждый раз — следующий не оценённый", async () => {
    const P2 = "a0000000-0000-4000-8000-000000000002";
    const P3 = "a0000000-0000-4000-8000-000000000003";
    const t = shopFor({
      items: [
        { id: P1, name: "Прописи" },
        { id: P2, name: "Пазлы" },
        { id: P3, name: "Раскраска" },
      ],
    });
    await t.say("5");
    expect(t.mode()).toBe("awaiting_rating");
    expect(t.sent.at(-1)).toContain(COPY.ru.reviewAskDirect("Пазлы"));
    await t.say("4");
    expect(t.mode()).toBe("awaiting_rating");
    expect(t.sent.at(-1)).toContain(COPY.ru.reviewAskDirect("Раскраска"));
    await t.say("3");
    expect(t.mode()).toBe("idle");
    expect(t.sent.at(-1)).toBe(COPY.ru.ratingThanks.replace(/<[^>]+>/g, ""));
    expect(t.db.tables.product_reviews).toMatchObject([
      { product_id: P1, rating: 5 },
      { product_id: P2, rating: 4 },
      { product_id: P3, rating: 3 },
    ]);
  });

  it("не цифра — обычная переписка: оценки нет, шаг снят", async () => {
    const t = shopFor({});
    await t.say("а когда будет новая коллекция?");
    expect(t.db.tables.product_reviews).toEqual([]);
    expect(t.mode()).toBe("idle");
    expect(t.sent).not.toContain(COPY.ru.ratingThanks);
  });

  it("цифра позже окна 24 часа — не оценка", async () => {
    const t = shopFor({ askedMinutesAgo: 25 * 60 });
    await t.say("5");
    expect(t.db.tables.product_reviews).toEqual([]);
    expect(t.mode()).toBe("idle");
  });

  it("покупка не выдана — оценку не принимаем", async () => {
    const t = shopFor({ bought: false });
    await t.say("4");
    expect(t.db.tables.product_reviews).toEqual([]);
    expect(t.sent.join("\n")).toContain("реально купили");
    expect(t.mode()).toBe("idle");
  });

  it("«7» и «0» — не оценка", async () => {
    for (const text of ["7", "0"]) {
      const t = shopFor({});
      await t.say(text);
      expect(t.db.tables.product_reviews).toEqual([]);
    }
  });
});
