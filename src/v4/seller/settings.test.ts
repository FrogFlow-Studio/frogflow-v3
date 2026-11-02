import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../test/pg";
import {
  normalizeProfile,
  normalizeSpamWords,
  saveSellerSettings,
  sellerSettings,
} from "./settings";

/**
 * Настройки ИИ-продавца на настоящем Postgres под ролью арендатора:
 * сохранение по версии, второй сотрудник со старой версией не затирает,
 * стоп-слова сразу работают в is_spam, лимит отсюда не меняется, чужой
 * магазин недоступен.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000a7";
const B = "bbbbbbbb-0000-4000-8000-0000000000b7";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B])
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("нормализация", () => {
  it("стоп-слова: без пустых, повторов и регистра", () => {
    expect(normalizeSpamWords([" Скидка ", "скидка", "", "x".repeat(61), "Казино"])).toEqual([
      "скидка",
      "казино",
    ]);
  });
  it("анкета: только известные поля, пустые не хранятся", () => {
    expect(
      normalizeProfile({ shop_name: " Копилка ", about: "  ", hack: "x", tone: "тепло" }),
    ).toEqual({ shop_name: "Копилка", tone: "тепло" });
  });
});

describe("настройки ИИ-продавца", () => {
  it("читаются, сохраняются, стоп-слово сразу работает в спам-фильтре", async () => {
    const s = await sellerSettings(asA(), A);
    expect(s).toMatchObject({ profile: {}, spamWords: [], limitMicroUsd: 5_000_000 });
    const r = await saveSellerSettings(asA(), {
      botId: A,
      profile: { shop_name: "Копилка", payment_terms: "Kaspi перевод, чек в чат" },
      spamWords: ["Казино"],
      version: s!.version,
    });
    expect(r).toEqual({ ok: true });
    const after = await sellerSettings(asA(), A);
    expect(after).toMatchObject({
      profile: { shop_name: "Копилка", payment_terms: "Kaspi перевод, чек в чат" },
      spamWords: ["казино"],
    });
    expect(after!.version).not.toBe(s!.version);
    const spam = await pg.query<{ s: boolean }>("select v4.is_spam($1, 'Лучшее КАЗИНО тут') s", [
      A,
    ]);
    expect(spam.rows[0]!.s).toBe(true);
  });

  it("второй сотрудник со старой версией не затирает сохранённое", async () => {
    const v = (await sellerSettings(asA(), A))!.version;
    expect(
      await saveSellerSettings(asA(), {
        botId: A,
        profile: { shop_name: "Первый" },
        spamWords: [],
        version: v,
      }),
    ).toEqual({ ok: true });
    expect(
      await saveSellerSettings(asA(), {
        botId: A,
        profile: { shop_name: "Второй" },
        spamWords: [],
        version: v,
      }),
    ).toEqual({ ok: false, code: "stale" });
    expect((await sellerSettings(asA(), A))!.profile.shop_name).toBe("Первый");
  });

  it("чужой магазин: не читается и не сохраняется; лимит ИИ арендатор не меняет", async () => {
    expect(await sellerSettings(asB(), A)).toBeNull();
    const v = (await sellerSettings(asA(), A))!.version;
    expect(
      await saveSellerSettings(asB(), {
        botId: A,
        profile: { shop_name: "B" },
        spamWords: [],
        version: v,
      }),
    ).toEqual({ ok: false, code: "stale" });
    await expect(
      pg.transaction(async (tx) => {
        await tx.query("set local role tenant_bot");
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ role: "tenant_bot", bot_id: A }),
        ]);
        await tx.query("update v4.shops set ai_monthly_limit_micro_usd = 1 where bot_id = $1", [A]);
      }),
    ).rejects.toThrow(/permission/);
  });
});
