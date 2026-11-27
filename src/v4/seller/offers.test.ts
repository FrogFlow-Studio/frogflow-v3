import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedKopilka } from "../test/kopilka";
import { pgliteV4, v4Db } from "../test/pg";

/**
 * Предложения (020): кнопка «Купить» = предложение с ценой на момент показа.
 * Д1 — восемь нажатий дают один заказ; Д2 — несколько товаров одной кнопкой;
 * Д3 — цена изменилась или срок вышел — отказ, а не заказ по другой цене.
 */
const K = "c0c0c0c0-0000-4000-8000-0000000005c1";
const X = "dddddddd-0000-4000-8000-0000000005d2";
let pg: PGlite;
let ids: Map<string, string>;
const asK = () => pgliteV4(pg, { botId: K });
type Offer = {
  offer_id: string;
  currency: string;
  total_minor: number;
  items: Array<{ title: string; amount_minor: number }>;
};
type Claim = {
  ok: boolean;
  order_id?: string;
  order_no?: number;
  reused?: boolean;
  reason?: string;
};

async function buyer(country = "KZ") {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, $2) returning id",
      [K, country],
    )
  ).rows[0]!.id;
}
const offer = async (b: string, titles: string[], mode = "live", now?: Date) =>
  (
    await asK().call("create_offer", {
      p_bot_id: K,
      p_buyer_id: b,
      p_product_ids: titles.map((t) => ids.get(t)),
      p_mode: mode,
      ...(now ? { p_now: now.toISOString() } : {}),
    })
  )[0]!.create_offer as Offer;
const claim = async (b: string, id: string, now?: Date) =>
  (
    await asK().call("claim_offer", {
      p_bot_id: K,
      p_buyer_id: b,
      p_offer_id: id,
      ...(now ? { p_now: now.toISOString() } : {}),
    })
  )[0]!.claim_offer as Claim;
const orders = async (b: string) =>
  Number(
    (
      await pg.query<{ n: number }>("select count(*)::int n from v4.orders where buyer_id = $1", [
        b,
      ])
    ).rows[0]!.n,
  );

beforeAll(async () => {
  pg = await v4Db();
  ids = await seedKopilka(pg, K);
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [X]);
});
afterAll(() => pg.close());

describe("предложение", () => {
  it("короткий id влезает в callback_data, цена на момент показа", async () => {
    const o = await offer(await buyer(), ["Палитра средств выразительности"]);
    expect(o.offer_id).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(new TextEncoder().encode(`offer:${o.offer_id}`).length).toBeLessThanOrEqual(64);
    expect(o).toMatchObject({ currency: "KZT", total_minor: 170000 });
  });

  it("Д2: «5-6-7 класс» — одна кнопка на сумму 7 500", async () => {
    const t = "Формативное оценивание: русский язык (Я1)";
    const o = await offer(await buyer(), [`${t} · 5 класс`, `${t} · 6 класс`, `${t} · 7 класс`]);
    expect(o.total_minor).toBe(750000);
    expect(o.items.map((i) => i.title)).toEqual([
      `${t} · 5 класс`,
      `${t} · 6 класс`,
      `${t} · 7 класс`,
    ]);
  });

  it("товар с вариантами — отказ choose_variant; больше 10 товаров — отказ", async () => {
    const b = await buyer();
    await expect(offer(b, ["Папка МО ЕМН"])).rejects.toThrow(/choose_variant/);
    const t = "Папка родительских собраний";
    const many = Array.from({ length: 11 }, () => `${t} · 5 класс`);
    await expect(offer(b, many)).rejects.toThrow();
  });
});

describe("нажатие «Купить» один раз (Д1)", () => {
  it("восемь нажатий одновременно — один заказ, у всех тот же номер", async () => {
    const b = await buyer();
    const o = await offer(b, ["Небосвод писателей"]);
    const r = await Promise.all(Array.from({ length: 8 }, () => claim(b, o.offer_id)));
    expect(new Set(r.map((x) => x.order_no)).size).toBe(1);
    expect(r.filter((x) => x.reused === false)).toHaveLength(1);
    expect(await orders(b)).toBe(1);
  });

  it("повторное нажатие позже — тот же заказ", async () => {
    const b = await buyer();
    const o = await offer(b, ["Небосвод писателей"]);
    const first = await claim(b, o.offer_id);
    const again = await claim(b, o.offer_id.toLowerCase());
    expect(again).toMatchObject({ ok: true, reused: true, order_no: first.order_no });
  });

  it("чужой покупатель и чужой магазин заказ не создают", async () => {
    const b = await buyer();
    const o = await offer(b, ["Небосвод писателей"]);
    expect(await claim(await buyer(), o.offer_id)).toEqual({ ok: false, reason: "not_found" });
    const foreign = await pgliteV4(pg, { botId: X }).call("claim_offer", {
      p_bot_id: K,
      p_buyer_id: b,
      p_offer_id: o.offer_id,
    });
    expect((foreign[0]!.claim_offer as Claim).ok).toBe(false);
    expect(await orders(b)).toBe(0);
  });
});

describe("цена на момент показа (Д3)", () => {
  it("срок 72 часа вышел — expired", async () => {
    const b = await buyer();
    const t = new Date("2026-11-27T10:00:00Z");
    const o = await offer(b, ["Небосвод писателей"], "live", t);
    const late = new Date(t.getTime() + 72 * 3600_000 + 1);
    expect(await claim(b, o.offer_id, late)).toEqual({ ok: false, reason: "expired" });
  });

  it("продавец поменял цену — price_changed, заказа нет", async () => {
    const b = await buyer();
    const o = await offer(b, ["Палитра средств выразительности"]);
    await pg.query("update v4.products set base_price_minor = 190000 where id = $1", [
      ids.get("Палитра средств выразительности"),
    ]);
    try {
      expect(await claim(b, o.offer_id)).toEqual({ ok: false, reason: "price_changed" });
      expect(await orders(b)).toBe(0);
    } finally {
      await pg.query("update v4.products set base_price_minor = 170000 where id = $1", [
        ids.get("Палитра средств выразительности"),
      ]);
    }
  });

  it("тень заказа не создаёт; тест создаёт пробный заказ", async () => {
    const b = await buyer();
    const sh = await offer(b, ["Небосвод писателей"], "shadow");
    expect(await claim(b, sh.offer_id)).toEqual({ ok: false, reason: "shadow" });
    const ts = await offer(b, ["Небосвод писателей"], "test");
    const r = await claim(b, ts.offer_id);
    const test = await pg.query<{ is_test: boolean }>(
      "select is_test from v4.orders where id = $1",
      [r.order_id],
    );
    expect(test.rows[0]!.is_test).toBe(true);
  });
});
