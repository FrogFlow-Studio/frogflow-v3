import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../test/pg";
import {
  blockBuyer,
  conversationHistory,
  countAiReply,
  maskContacts,
  recordIncoming,
  recordReply,
  releaseTurn,
  rememberFact,
  takeTurn,
  unblockBuyer,
} from "./conversation";

/**
 * Разговор (017) на настоящем Postgres под ролью арендатора: повтор вебхука,
 * ход, предел ответов ИИ в день, память, блок, изоляция магазинов.
 */
const A = "aaaaaaaa-0000-4000-8000-0000000001a1";
const B = "bbbbbbbb-0000-4000-8000-0000000001b2";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });
const T1 = "11111111-0000-4000-8000-000000000001";
const T2 = "22222222-0000-4000-8000-000000000002";

async function buyer(bot = A) {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
      [bot],
    )
  ).rows[0]!.id;
}

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B])
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
});
afterAll(() => pg.close());

describe("журнал и повтор вебхука", () => {
  it("то же входящее дважды — одна строка, второй раз duplicate", async () => {
    const b = await buyer();
    const msg = { botId: A, buyerId: b, channel: "telegram" as const, mode: "live" as const };
    const first = await recordIncoming(asA(), { ...msg, externalId: "tg:42", text: "Привет" });
    const again = await recordIncoming(asA(), { ...msg, externalId: "tg:42", text: "Привет" });
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ messageId: first.messageId, duplicate: true });
    const both = await Promise.all([
      recordIncoming(asA(), { ...msg, externalId: "tg:43", text: "a" }),
      recordIncoming(asA(), { ...msg, externalId: "tg:43", text: "a" }),
    ]);
    expect(both.filter((x) => x.duplicate)).toHaveLength(1);
  });

  it("история хранит кнопки и действия, по режимам отдельно, старые первыми", async () => {
    const b = await buyer();
    const base = { botId: A, buyerId: b, channel: "telegram" as const };
    await recordIncoming(asA(), { ...base, mode: "live", externalId: "h1", text: "Папка?" });
    await recordReply(asA(), {
      ...base,
      mode: "live",
      text: "Папка 3 500 ₸",
      source: "model",
      buttons: [{ offerId: "AB12", label: "Купить: Папка" }],
      actions: [{ kind: "offer", offer_id: "AB12" }],
      costMicroUsd: 15000,
    });
    await recordReply(asA(), { ...base, mode: "shadow", text: "тень", source: "model" });
    const live = await conversationHistory(asA(), { botId: A, buyerId: b, mode: "live" });
    expect(live.map((m) => m.text)).toEqual(["Папка?", "Папка 3 500 ₸"]);
    expect(live[1]!.buttons).toEqual([{ offerId: "AB12", label: "Купить: Папка" }]);
    expect(live[1]!.actions[0]).toMatchObject({ kind: "offer" });
    const shadow = await conversationHistory(asA(), { botId: A, buyerId: b, mode: "shadow" });
    expect(shadow.map((m) => m.text)).toEqual(["тень"]);
  });

  it("чужой магазин не пишет и не читает журнал покупателя A", async () => {
    const b = await buyer();
    await recordIncoming(asA(), {
      botId: A,
      buyerId: b,
      channel: "telegram",
      mode: "live",
      externalId: "iso1",
      text: "секрет",
    });
    expect(await conversationHistory(asB(), { botId: A, buyerId: b, mode: "live" })).toEqual([]);
    await expect(
      recordIncoming(asB(), {
        botId: A,
        buyerId: b,
        channel: "telegram",
        mode: "live",
        externalId: "iso2",
        text: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("ход: один ответ на покупателя за раз", () => {
  it("из двух одновременных берёт ход один; занятый ход истекает сам", async () => {
    const b = await buyer();
    const now = new Date("2026-11-27T10:00:00Z");
    const [x, y] = await Promise.all([
      takeTurn(asA(), { botId: A, buyerId: b, turnId: T1, now }),
      takeTurn(asA(), { botId: A, buyerId: b, turnId: T2, now }),
    ]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    const later = new Date(now.getTime() + 91_000);
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T2, now: later })).toBe(true);
  });

  it("пришло второе сообщение во время хода — ход не отпущен, ответ за оба", async () => {
    const b = await buyer();
    const base = { botId: A, buyerId: b, channel: "telegram" as const, mode: "live" as const };
    const m1 = await recordIncoming(asA(), { ...base, externalId: "q1", text: "Папка" });
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T1 })).toBe(true);
    await recordIncoming(asA(), { ...base, externalId: "q2", text: "и сколько стоит?" });
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T2 })).toBe(false);
    const pending = await releaseTurn(asA(), {
      botId: A,
      buyerId: b,
      turnId: T1,
      afterMessageId: m1.messageId,
    });
    expect(pending).toBe(1);
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T2 })).toBe(false);
    const hist = await conversationHistory(asA(), { botId: A, buyerId: b, mode: "live" });
    const last = hist.at(-1)!.id;
    expect(
      await releaseTurn(asA(), { botId: A, buyerId: b, turnId: T1, afterMessageId: last }),
    ).toBe(0);
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T2 })).toBe(true);
  });

  it("входящее другого режима не держит ход", async () => {
    const b = await buyer();
    const live = await recordIncoming(asA(), {
      botId: A,
      buyerId: b,
      channel: "telegram",
      mode: "live",
      externalId: "live-1",
      text: "есть",
    });
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T1 })).toBe(true);
    await recordIncoming(asA(), {
      botId: A,
      buyerId: b,
      channel: "test",
      mode: "test",
      externalId: "test-1",
      text: "проверка",
    });
    expect(
      await releaseTurn(asA(), {
        botId: A,
        buyerId: b,
        turnId: T1,
        afterMessageId: live.messageId,
        mode: "live",
      }),
    ).toBe(0);
    expect(await takeTurn(asA(), { botId: A, buyerId: b, turnId: T2 })).toBe(true);
  });
});

describe("предел ответов ИИ покупателю в день (E05)", () => {
  it("40 проходят, 41-й нет; на следующий день по часам магазина снова можно", async () => {
    const b = await buyer();
    const day = new Date("2026-11-27T12:00:00Z");
    for (let i = 0; i < 40; i++)
      expect(await countAiReply(asA(), { botId: A, buyerId: b, now: day })).toBe(true);
    expect(await countAiReply(asA(), { botId: A, buyerId: b, now: day })).toBe(false);
    // 19:30 UTC — уже 28.11 в Алматы (UTC+5).
    const next = new Date("2026-11-27T19:30:00Z");
    expect(await countAiReply(asA(), { botId: A, buyerId: b, now: next })).toBe(true);
  });

  it("гонка на последнем месте: из двух одновременных проходит один", async () => {
    const b = await buyer();
    const day = new Date("2026-11-27T12:00:00Z");
    for (let i = 0; i < 2; i++)
      await countAiReply(asA(), { botId: A, buyerId: b, limit: 3, now: day });
    const r = await Promise.all([
      countAiReply(asA(), { botId: A, buyerId: b, limit: 3, now: day }),
      countAiReply(asA(), { botId: A, buyerId: b, limit: 3, now: day }),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
});

describe("память о покупателе: только безопасные факты", () => {
  it("класс, предмет, язык и страна запоминаются; язык и страна — и в карточке", async () => {
    const b = await buyer();
    const put = (key: string, value: string) =>
      rememberFact(asA(), { botId: A, buyerId: b, key, value });
    expect(await put("grade", "5")).toBe("ok");
    expect(await put("subject", "русский язык")).toBe("ok");
    expect(await put("language", "kk")).toBe("ok");
    expect(await put("country", "ru")).toBe("ok");
    const card = await pg.query<{ language: string; country: string }>(
      "select language, country from v4.buyers where id = $1",
      [b],
    );
    expect(card.rows[0]).toEqual({ language: "kk", country: "RU" });
    expect(await put("grade", "5")).toBe("ok");
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.buyer_facts where buyer_id = $1",
      [b],
    );
    expect(n.rows[0]!.n).toBe(4);
  });

  it("суммы, телефоны, почта, скидки и обещания не запоминаются", async () => {
    const b = await buyer();
    const put = (key: string, value: string) =>
      rememberFact(asA(), { botId: A, buyerId: b, key, value });
    expect(await put("notes", "обещали скидку 20%")).toBe("forbidden");
    expect(await put("notes", "договорились на 2000 тенге")).toBe("forbidden");
    expect(await put("notes", "телефон +7 701 123 45 67")).toBe("forbidden");
    expect(await put("notes", "почта aigul@mail.ru")).toBe("forbidden");
    expect(await put("notes", "сказала, что подарок дочке")).toBe("forbidden");
    expect(await put("notes", "жеңілдік сұрады")).toBe("forbidden");
    expect(await put("for_whom", "for my daughter, free delivery")).toBe("forbidden");
    expect(await put("grade", "12")).toBe("bad_value");
    expect(await put("language", "de")).toBe("bad_value");
    expect(await put("name", "А".repeat(41))).toBe("bad_value");
    expect(await put("password", "x")).toBe("bad_key");
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.buyer_facts where buyer_id = $1",
      [b],
    );
    expect(n.rows[0]!.n).toBe(0);
  });
});

describe("блок покупателя", () => {
  it("блок и снятие ставятся один раз", async () => {
    const b = await buyer();
    expect(await blockBuyer(asA(), { botId: A, buyerId: b, by: "seller" })).toBe(true);
    expect(await blockBuyer(asA(), { botId: A, buyerId: b, by: "seller" })).toBe(false);
    expect(await unblockBuyer(asA(), { botId: A, buyerId: b })).toBe(true);
    expect(await unblockBuyer(asA(), { botId: A, buyerId: b })).toBe(false);
    expect(await blockBuyer(asB(), { botId: A, buyerId: b, by: "seller" })).toBe(false);
  });
});

describe("маскировка контактов для модели", () => {
  it("телефон, почта и карта маскируются, цены и классы — нет", () => {
    expect(maskContacts("мой номер +7 777 123 45 51")).toBe("мой номер +7 7** *** ** 51");
    expect(maskContacts("87011234567")).toBe("8********67");
    expect(maskContacts("пишите aigul@mail.ru")).toBe("пишите a***@mail.ru");
    expect(maskContacts("карта 4400 4300 1234 5678")).toBe("карта 4*** **** **** **78");
    expect(maskContacts("Папка 3 500 ₸, 5-6-7 класс, 2026 год")).toBe(
      "Папка 3 500 ₸, 5-6-7 класс, 2026 год",
    );
  });
});
