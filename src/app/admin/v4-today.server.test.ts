import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { handToSeller } from "@/v4/core/cases/cases";
import type { V4Db } from "@/v4/core/db";
import { recordPayment } from "@/v4/core/money/money";
import { placeOrder, touchBuyer } from "@/v4/core/platform";
import { pgliteV4, v4Db } from "@/v4/test/pg";
import {
  addV4Lesson,
  advanceV4Order,
  loadV4Today,
  runV4CaseAction,
  saveV4Method,
  saveV4Product,
  stocktakeV4,
} from "./v4-today.server";

/**
 * Страница «Сегодня (v4)»: схема v4 не открыта в PostgREST — пояснение, не
 * сбой; магазина в v4 нет — пояснение и ни одной кнопки; магазин есть —
 * дела на языке продавца и кнопка работает. Другие ошибки базы — сбой.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const NONE = "cccccccc-0000-4000-8000-0000000000d2";
let pg: PGlite;
const ctxOf = (id: string) => ({ tenant: { id } }) as unknown as TenantContext;

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

const failing = (message: string): V4Db => ({
  call: () => Promise.reject(serverFailure(`v4.shop_ready не выполнилась: ${message}`)),
});

describe("«Сегодня (v4)»", () => {
  it("схема v4 не открыта — «не подключена», а не сбой", async () => {
    const db = failing("The schema must be one of the following: public, graphql_public");
    expect(await loadV4Today(ctxOf(A), "ru", db)).toEqual({ state: "not_connected" });
  });

  it("другая ошибка базы — сбой", async () => {
    await expect(loadV4Today(ctxOf(A), "ru", failing("connection reset"))).rejects.toThrow(
      /connection reset/,
    );
  });

  it("магазина нет в v4 — пояснение, кнопки не действуют", async () => {
    const db = pgliteV4(pg, { botId: NONE });
    expect(await loadV4Today(ctxOf(NONE), "ru", db)).toEqual({ state: "no_shop" });
    expect(
      await runV4CaseAction(
        ctxOf(NONE),
        { caseId: "00000000-0000-4000-8000-000000000000", action: "close_case", by: "x" },
        db,
      ),
    ).toEqual({ ok: false, code: "case_not_found" });
  });

  it("магазин есть — дела на языке продавца, «Вернуть боту» работает", async () => {
    const db = pgliteV4(pg, { botId: A });
    const buyer = (
      await pg.query<{ id: string }>(
        "insert into v4.buyers (bot_id, country, name) values ($1, 'UZ', 'Dilnoza') returning id",
        [A],
      )
    ).rows[0]!.id;
    const caseId = await handToSeller(db, { botId: A, buyerId: buyer, reason: "?", by: "bot" });
    const v = await loadV4Today(ctxOf(A), "uz", db);
    if (v.state !== "ready") throw new Error(v.state);
    expect(v.screen.cards.map((c) => [c.title, c.secondary.label])).toEqual([
      ["Xaridor javobingizni kutmoqda", "Botga qaytarish"],
    ]);
    expect(
      await runV4CaseAction(ctxOf(A), { caseId, action: "return_to_bot", by: "admin:o" }, db),
    ).toEqual({ ok: true });
    const after = await loadV4Today(ctxOf(A), "uz", db);
    expect(after.state === "ready" && after.screen.cards).toEqual([]);
  });

  it("товар виден в списке, повторный пересчёт с тем же ключом не двигает склад, урок и способ оплаты записываются", async () => {
    const db = pgliteV4(pg, { botId: A });
    const ctx = ctxOf(A);
    const saved = await saveV4Product(
      ctx,
      {
        title: "Папка",
        kind: "file",
        priceMinor: 100_000,
        description: "5 класс",
        trackStock: true,
      },
      db,
    );
    if (!saved.ok) throw new Error(saved.code);
    const renamed = await saveV4Product(
      ctx,
      {
        title: "Папка 5 класс",
        kind: "file",
        priceMinor: 120_000,
        description: "40 листов",
        productId: saved.value,
        trackStock: true,
      },
      db,
    );
    expect(renamed).toEqual({ ok: true, value: saved.value });
    const first = await stocktakeV4(
      ctx,
      { productId: saved.value, target: 5, externalRef: "count-1", by: "seller" },
      db,
    );
    const second = await stocktakeV4(
      ctx,
      { productId: saved.value, target: 9, externalRef: "count-1", by: "seller" },
      db,
    );
    expect(first).toEqual({ ok: true, value: 5 });
    expect(second).toEqual({ ok: true, value: 5 });
    const club = await saveV4Product(
      ctx,
      { title: "Клуб", kind: "club", priceMinor: 200_000, description: "поток" },
      db,
    );
    if (!club.ok) throw new Error(club.code);
    const lesson = await addV4Lesson(ctx, { productId: club.value, title: "Урок 1" }, db);
    expect(lesson.ok).toBe(true);
    const method = await saveV4Method(
      ctx,
      { kind: "transfer", country: "KZ", currency: "KZT", details: "Kaspi 777" },
      db,
    );
    expect(method.ok).toBe(true);
    const mismatch = await saveV4Method(
      ctx,
      { kind: "transfer", country: "RU", currency: "KZT", details: "счёт" },
      db,
    );
    expect(mismatch).toEqual({ ok: false, code: "bad_status" });
    const view = await loadV4Today(ctx, "ru", db);
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.products.find((p) => p.id === saved.value)).toMatchObject({
      title: "Папка 5 класс",
      priceMinor: 120_000,
      onHand: 5,
    });
    expect(view.lessons.map((l) => l.title)).toEqual(["Урок 1"]);
    expect(view.methods.map((m) => m.details)).toContain("Kaspi 777");
  });

  it("заказ показывает книгу: оплачено и долг, после «передан» шаг отказывает", async () => {
    const db = pgliteV4(pg, { botId: A });
    const ctx = ctxOf(A);
    const saved = await saveV4Product(
      ctx,
      { title: "Лестница", kind: "file", priceMinor: 80_000, description: "урок" },
      db,
    );
    if (!saved.ok) throw new Error(saved.code);
    const buyerId = await touchBuyer(db, {
      botId: A,
      channel: "web",
      externalId: "desk-buyer",
      country: "KZ",
    });
    const order = await placeOrder(db, {
      botId: A,
      buyerId,
      country: "KZ",
      productIds: [saved.value],
      by: "web",
    });
    if (!order.ok) throw new Error(order.code);
    const pay = await recordPayment(db, {
      botId: A,
      orderId: order.value.id,
      amountMinor: 30_000,
      currency: "KZT",
      method: "transfer",
      externalRef: "pay-1",
      by: "seller",
    });
    if (!pay.ok) throw new Error(pay.code);
    const view = await loadV4Today(ctx, "ru", db);
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.orders.find((o) => o.orderId === order.value.id)).toMatchObject({
      paidMinor: 30_000,
      dueMinor: 50_000,
      moneyState: "partial",
      nextStep: "accepted",
    });
    const extra = await recordPayment(db, {
      botId: A,
      orderId: order.value.id,
      amountMinor: 60_000,
      currency: "KZT",
      method: "transfer",
      externalRef: "pay-2",
      by: "seller",
    });
    if (!extra.ok) throw new Error(extra.code);
    const over = await loadV4Today(ctx, "ru", db);
    if (over.state !== "ready") throw new Error(over.state);
    expect(over.orders.find((o) => o.orderId === order.value.id)).toMatchObject({
      paidMinor: 90_000,
      dueMinor: 0,
      moneyState: "overpaid",
    });
    for (const step of ["accepted", "working", "ready", "handed"] as const) {
      const moved = await advanceV4Order(ctx, { orderId: order.value.id, by: "seller" }, db);
      expect(moved).toEqual({ ok: true, value: step });
    }
    expect(await advanceV4Order(ctx, { orderId: order.value.id, by: "seller" }, db)).toEqual({
      ok: false,
      code: "bad_step",
    });
    const after = await loadV4Today(ctx, "ru", db);
    if (after.state !== "ready") throw new Error(after.state);
    expect(after.orders.find((o) => o.orderId === order.value.id)?.nextStep).toBeNull();
  });
});
