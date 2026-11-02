import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serverFailure } from "@/lib/server-failure";
import { openCase, tick } from "@/v4/core/cases/cases";
import { pgliteV4, v4Db } from "@/v4/test/pg";
import { loadV4Attention } from "./v4-attention.server";

/**
 * «Внимание (v4)»: схема не открыта — пояснение; поднятое дело видно с
 * именем магазина из справочника; другая ошибка базы — сбой.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000e1";
const HOUR = 3_600_000;
let pg: PGlite;
const names = async () => [
  { id: A, name: "Копилка" },
  { id: "x", name: "Чужой" },
];

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("«Внимание (v4)»", () => {
  it("схема v4 не открыта — «не подключена»", async () => {
    const db = {
      call: () =>
        Promise.reject(serverFailure("v4.attention: The schema must be one of the following")),
    };
    expect(await loadV4Attention(db, names)).toEqual({ state: "not_connected" });
  });

  it("другая ошибка базы — сбой", async () => {
    const db = { call: () => Promise.reject(serverFailure("v4.attention: timeout")) };
    await expect(loadV4Attention(db, names)).rejects.toThrow(/timeout/);
  });

  it("пусто — без запроса справочника; поднятое дело — с именем магазина", async () => {
    let asked = 0;
    const empty = await loadV4Attention(pgliteV4(pg), async () => {
      asked++;
      return names();
    });
    expect(empty.state === "ready" && empty.screen.cases).toEqual([]);
    const ch = await openCase(pgliteV4(pg, { botId: A }), {
      botId: A,
      kind: "channel_down",
      dedupeKey: "whatsapp",
      by: "watch",
    });
    expect(ch.ok).toBe(true);
    await tick(pgliteV4(pg), new Date(Date.now() + 30 * HOUR));
    const v = await loadV4Attention(pgliteV4(pg), names);
    if (v.state !== "ready") throw new Error(v.state);
    expect(v.names).toEqual({ [A]: "Копилка" });
    expect(v.screen.shops.map((s) => s.botId)).toEqual([A]);
    expect(asked).toBe(1);
  });
});
