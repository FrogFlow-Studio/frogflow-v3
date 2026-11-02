import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { handToSeller } from "@/v4/core/cases/cases";
import type { V4Db } from "@/v4/core/db";
import { pgliteV4, v4Db } from "@/v4/test/pg";
import { loadV4Today, runV4CaseAction } from "./v4-today.server";

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
});
