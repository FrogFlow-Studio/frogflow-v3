import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { sourceFunnel } from "./funnel.server";
import { revenueParts, SourceFunnelAcc, sourceGroup } from "./source-funnel";

describe("группа источника", () => {
  it("личные ссылки сводятся, метки — как есть", () => {
    expect(sourceGroup(undefined)).toBe("direct");
    expect(sourceGroup("")).toBe("direct");
    expect(sourceGroup("ref_ABC123")).toBe("referral");
    expect(sourceGroup("wc_token")).toBe("storefront");
    expect(sourceGroup("p_0000")).toBe("product");
    expect(sourceGroup("site:google/spring")).toBe("site:google/spring");
    // Одна метка из генератора ссылок — одна строка для бота и сайта.
    expect(sourceGroup("src_insta")).toBe("tag:insta");
    expect(sourceGroup("site:insta")).toBe("tag:insta");
    expect(sourceGroup("src_")).toBe("src_");
    expect(sourceGroup("site:ref-anna")).toBe("referral");
    expect(sourceGroup("site:ig ref-blog")).toBe("referral");
    expect(sourceGroup("site:prefix-ref-x")).toBe("tag:prefix-ref-x");
  });

  it("хвост после первых групп — «другие», «все» считает всё", () => {
    const acc = new SourceFunnelAcc();
    for (let i = 0; i < 5; i++)
      acc.user({ platform: "telegram", user_key: `tg_${i}`, state: { first_source: `src_${i}` } });
    const rows = acc.rows(3);
    expect(rows.map((r) => r.source)).toEqual(["all", "tag:0", "tag:1", "tag:2", "other"]);
    expect(rows[0]!.arrived).toBe(5);
    expect(rows.at(-1)!.arrived).toBe(2);
  });
});

describe("воронка по источникам из базы", () => {
  const BOT = "00000000-0000-0000-0000-000000000001";
  const at = "2026-09-20T10:00:00.000Z";
  function shop() {
    const db = fakeDb();
    db.tables.bot_users = [
      // Пришёл до периода по рекламе, купил в периоде.
      {
        bot_id: BOT,
        user_key: "tg_1",
        telegram_id: 1,
        platform: "telegram",
        state: { first_source: "src_insta" },
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        bot_id: BOT,
        user_key: "web_a",
        telegram_id: -5,
        platform: "web",
        state: { first_source: "site:google/spring" },
        created_at: at,
      },
      {
        bot_id: BOT,
        user_key: "tg_2",
        telegram_id: 2,
        platform: "telegram",
        state: {},
        created_at: at,
      },
    ];
    db.tables.cart_items = [
      { id: "c1", bot_id: BOT, user_key: "tg_2", telegram_id: 2, created_at: at },
    ];
    db.tables.orders = [
      {
        id: 1,
        bot_id: BOT,
        platform: "telegram",
        user_key: "tg_1",
        telegram_id: 1,
        status: "delivered",
        fulfillment_kind: "digital",
        total: 5000,
        paid_amount: 5000,
        currency: "KZT",
        created_at: at,
      },
      {
        id: 2,
        bot_id: BOT,
        platform: "web",
        user_key: "web_a",
        telegram_id: -5,
        status: "awaiting_payment",
        fulfillment_kind: "digital",
        total: 3000,
        paid_amount: 0,
        currency: "KZT",
        created_at: at,
      },
      // Заказ продавца вручную в воронку не входит.
      {
        id: 3,
        bot_id: BOT,
        platform: "manual",
        user_key: "manual:x",
        telegram_id: 0,
        status: "delivered",
        fulfillment_kind: "physical",
        total: 9000,
        paid_amount: 9000,
        currency: "KZT",
        created_at: at,
      },
    ];
    return { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
  }

  it("этапы и выручка по первому источнику покупателя", async () => {
    const rows = await sourceFunnel(
      shop(),
      new Date("2026-09-15T00:00:00Z"),
      new Date("2026-09-25T00:00:00Z"),
    );
    const by = Object.fromEntries(rows.map((r) => [r.source, r]));
    expect(by.all).toMatchObject({
      arrived: 2,
      cart: 3,
      ordered: 2,
      paid: 1,
      revenue: { KZT: 5000 },
    });
    expect(by["tag:insta"]).toMatchObject({
      arrived: 0,
      ordered: 1,
      paid: 1,
      revenue: { KZT: 5000 },
    });
    expect(by["site:google/spring"]).toMatchObject({ arrived: 1, ordered: 1, paid: 0 });
    expect(by.direct).toMatchObject({ arrived: 1, cart: 1, ordered: 0 });
  });
});

describe("выручка по валютам в строке источника", () => {
  it("основная валюта первой, другие — рядом, без пересчёта", () => {
    expect(revenueParts({}, "KZT")).toEqual([{ currency: "KZT", amount: 0 }]);
    expect(revenueParts({ USD: 20, KZT: 5000, RUB: 0, EUR: 3 }, "KZT")).toEqual([
      { currency: "KZT", amount: 5000 },
      { currency: "EUR", amount: 3 },
      { currency: "USD", amount: 20 },
    ]);
  });
});
