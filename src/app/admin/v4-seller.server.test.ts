import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { pgliteV4, v4Db } from "@/v4/test/pg";
import { loadV4Seller, saveV4Seller } from "./v4-seller.server";

/** «ИИ-продавец (v4)»: не подключена / нет магазина / сохранение по версии. */

const A = "aaaaaaaa-0000-4000-8000-0000000000f7";
const NONE = "cccccccc-0000-4000-8000-0000000000f8";
let pg: PGlite;
const ctxOf = (id: string) => ({ tenant: { id } }) as unknown as TenantContext;

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("«ИИ-продавец (v4)»", () => {
  it("схема не открыта — «не подключена»; другая ошибка — сбой", async () => {
    const fail = (m: string) => ({ call: () => Promise.reject(serverFailure(m)) });
    expect(await loadV4Seller(ctxOf(A), fail("PGRST106: schema must be one of"))).toEqual({
      state: "not_connected",
    });
    await expect(loadV4Seller(ctxOf(A), fail("boom"))).rejects.toThrow(/boom/);
  });

  it("магазина нет в v4 — пояснение", async () => {
    expect(await loadV4Seller(ctxOf(NONE), pgliteV4(pg, { botId: NONE }))).toEqual({
      state: "no_shop",
    });
  });

  it("анкета сохраняется и видна при следующем открытии", async () => {
    const db = pgliteV4(pg, { botId: A });
    const v = await loadV4Seller(ctxOf(A), db);
    if (v.state !== "ready") throw new Error(v.state);
    expect(
      await saveV4Seller(
        ctxOf(A),
        {
          profile: { delivery_terms: "Файл в чат сразу после оплаты" },
          spamWords: [],
          version: v.settings.version,
        },
        db,
      ),
    ).toEqual({ ok: true });
    const again = await loadV4Seller(ctxOf(A), db);
    expect(again.state === "ready" && again.settings.profile).toEqual({
      delivery_terms: "Файл в чат сразу после оплаты",
    });
  });
});
