import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CASE_KINDS, handToSeller, openCase, tick } from "../core/cases/cases";
import { createOrder, recordPayment, submitReceipt } from "../core/money/money";
import { pgliteV4, v4Db } from "../test/pg";
import { ACTION_LABELS, attention, CASE_ACTIONS, CASE_CARDS, today } from "./screens";

/**
 * «Сегодня» и «Внимание» на настоящем Postgres (PGlite). Примеры из макета:
 * AATeach — чек ждёт 2 дня; Копилка — канал молчит; BOVI — покупатель ждёт ответа.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const B = "bbbbbbbb-0000-4000-8000-0000000000f2";
const HOUR = 3_600_000;
let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });
let buyer: string;
let product: string;

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B]) {
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
  }
  buyer = (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country, name) values ($1, 'KZ', 'Мария') returning id",
      [A],
    )
  ).rows[0]!.id;
  product = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Тетрадь', 'file', 450000) returning id",
      [A],
    )
  ).rows[0]!.id;
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("карточки дел", () => {
  it("у каждого вида дела есть заголовок и кнопки на 4 языках", () => {
    expect(Object.keys(CASE_CARDS).sort()).toEqual([...CASE_KINDS].sort());
    for (const c of Object.values(CASE_CARDS)) {
      for (const lang of ["ru", "kk", "en", "uz"] as const) expect(c.title[lang]).toBeTruthy();
      expect(CASE_ACTIONS).toContain(c.primary);
      expect(CASE_ACTIONS).toContain(c.secondary);
    }
    for (const a of CASE_ACTIONS)
      for (const lang of ["ru", "kk", "en", "uz"] as const)
        expect(ACTION_LABELS[a][lang]).toBeTruthy();
  });
});

describe("«Сегодня» продавца", () => {
  it("пусто — пустой экран, «бот сделал сам» в нулях", async () => {
    const s = await today(asB(), B);
    expect(s.cards).toEqual([]);
    expect(s.botDid).toMatchObject({ orders: 0, paid: 0, delivered: 0, commentsAnswered: 0 });
    expect(s.aiRoomMicroUsd).toBe(5_000_000);
  });

  it("чек, передача продавцу и молчащий канал — канал первым, у чека номер заказа и имя", async () => {
    const o = await createOrder(asA(), {
      botId: A,
      buyerId: buyer,
      country: "KZ",
      productIds: [product],
      by: "bot",
    });
    if (!o.ok) throw new Error(o.code);
    const r = await submitReceipt(asA(), {
      botId: A,
      orderId: o.value.id,
      storagePath: "r/1.jpg",
      fingerprint: "a".repeat(64),
    });
    expect(r.ok).toBe(true);
    await handToSeller(asA(), { botId: A, buyerId: buyer, reason: "по 130 приказу?", by: "bot" });
    const ch = await openCase(asA(), {
      botId: A,
      kind: "channel_down",
      dedupeKey: "whatsapp",
      by: "watch",
    });
    expect(ch.ok).toBe(true);

    const s = await today(asA(), A, "kk");
    expect(s.cards.map((c) => c.kind)).toEqual(["channel_down", "receipt_review", "handoff"]);
    const receipt = s.cards[1]!;
    expect(receipt.subject).toBe(`Тапсырыс №${o.value.no} · Мария`);
    expect(receipt.primary).toEqual({ action: "receipt_accept", label: "Ақша түсті" });
    expect(s.cards[0]!.light).toBe("red");
    expect(receipt.light).toBe("green");
    expect(s.botDid.orders).toBe(1);
  });

  it("второй магазин дел первого не видит", async () => {
    expect((await today(asB(), B)).cards).toEqual([]);
    // Чужой bot_id в аргументе — RLS всё равно отдаёт только свои строки.
    expect((await today(asB(), A)).cards).toEqual([]);
  });

  it("срок вышел — дело поднято оператору, но работа продавца остаётся у него на экране", async () => {
    // Тик на 3 суток вперёд: чек — напоминание (через 2 ч), потом поднято оператору (через 24 ч).
    await tick(svc(), new Date(Date.now() + 3 * HOUR));
    await tick(svc(), new Date(Date.now() + 25 * HOUR));
    const s = await today(asA(), A, "ru", new Date(Date.now() + 25 * HOUR));
    const receipt = s.cards.find((c) => c.kind === "receipt_review")!;
    expect(receipt.light).toBe("red");
    const a = await attention(svc(), new Date(Date.now() + 25 * HOUR));
    expect(a.cases.some((c) => c.kind === "receipt_review" && c.botId === A)).toBe(true);
  });

  it("оплаченный заказ попадает в «бот сделал сам», тестовый — нет", async () => {
    const before = (await today(asA(), A)).botDid;
    for (const isTest of [false, true]) {
      const o = await createOrder(asA(), {
        botId: A,
        buyerId: buyer,
        country: "KZ",
        productIds: [product],
        isTest,
        by: "bot",
      });
      if (!o.ok) throw new Error(o.code);
      const p = await recordPayment(asA(), {
        botId: A,
        orderId: o.value.id,
        amountMinor: o.value.totalMinor,
        currency: "KZT",
        method: "transfer",
        externalRef: `t-${String(isTest)}`,
        by: "t",
      });
      if (!p.ok) throw new Error(p.code);
    }
    const after = (await today(asA(), A)).botDid;
    expect(after.orders - before.orders).toBe(1);
    expect(after.paid - before.paid).toBe(1);
  });
});

describe("«Внимание» оператора", () => {
  it("светофор магазинов: с поднятым делом — красный, без дел — зелёный", async () => {
    const a = await attention(svc(), new Date(Date.now() + 25 * HOUR));
    const byBot = Object.fromEntries(a.shops.map((s) => [s.botId, s]));
    expect(byBot[A]!.light).toBe("red");
    expect(byBot[B]).toMatchObject({ light: "green", openCases: 0 });
  });

  it("арендатору экран оператора недоступен", async () => {
    await expect(asA().call("attention", {})).rejects.toThrow(/permission/);
  });
});
