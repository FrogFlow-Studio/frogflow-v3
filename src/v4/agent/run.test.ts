import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../test/pg";
import { blockBuyer, recordIncoming } from "./conversation";
import { scriptedAgentModel, type ScriptedTurn } from "./model";
import {
  type AgentRole,
  type AgentReply,
  type AgentResult,
  detectLang,
  runAgent,
  toModelMessages,
} from "./run";

/**
 * Ядро на настоящем Postgres и записанной модели, с «пустой ролью» из двух
 * инструментов (тест архитектуры, проект 5.5: новая роль не трогает ядро).
 * Каждая строка порядка из run.ts — отдельная проверка. Ошибки 05.11 1–3 здесь.
 */
const A = "aaaaaaaa-0000-4000-8000-0000000003a1";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
let aiEnabled = true;

const role: AgentRole = {
  purpose: "seller",
  tools: [
    {
      name: "show_item",
      description: "показать",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "pass_to_human",
      description: "передать",
      input_schema: { type: "object", properties: {} },
    },
  ],
  async loadContext(_db, a) {
    return {
      aiEnabled,
      lang: detectLang(a.text, "ru"),
      system: [
        { text: "неизменное", cache: true },
        { text: "магазин", cache: true },
        { text: "покупатель", cache: false },
      ],
      dailyCapMicroUsd: null,
      check: {
        prices: [1700],
        allowedNumbers: [],
        shopText: "Kaspi",
        deliveryTerms: "Файл приходит сюда",
        quoted: [],
        allowedContacts: [],
      },
    };
  },
  async runTool(_db, s, _a, name) {
    if (name === "show_item") {
      s.buttons.push({ offerId: "AB12", label: "Купить: Палитра" });
      s.quoted.push("Палитра средств выразительности");
      return { ok: true, offer: "AB12", price: 1700 };
    }
    s.handedOff = true;
    s.actions.push({ kind: "handoff" });
    return { ok: true };
  },
  async fallback(_db, _s, a, reason) {
    return { text: `простой ответ (${reason}, ${a.lang})` };
  },
};

let n = 0;
async function buyer() {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
      [A],
    )
  ).rows[0]!.id;
}
const balance = async () =>
  Number(
    (
      await pg.query<{ b: string }>(
        "select coalesce((select balance_micro_usd from v4.ai_wallet where bot_id = $1), 0) b",
        [A],
      )
    ).rows[0]!.b,
  );
const call = (name: string) => ({ id: `t${++n}`, name, input: {} });

async function run(
  b: string,
  text: string,
  turns: ScriptedTurn[],
  over: Partial<Parameters<typeof runAgent>[0]> = {},
) {
  const model = scriptedAgentModel(turns);
  const r = await runAgent({
    db: asA(),
    role,
    model,
    markupBp: async () => 2500,
    botId: A,
    buyerId: b,
    mode: "live",
    channel: "telegram",
    externalId: `m${++n}`,
    text,
    sleep: async () => undefined,
    ...over,
  });
  return { r, model };
}
const one = (r: AgentResult): AgentReply => {
  if (r.kind !== "reply") throw new Error(`ожидался ответ, а не ${r.reason}`);
  return r.replies[0]!;
};

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
  await pg.query("select v4.ai_credit($1, 'topup', 5000000, 'тест', 'operator')", [A]);
});
afterAll(() => pg.close());

describe("ошибки 05.11 в ядре", () => {
  it("1: текст круга с инструментом не теряется — цена и кнопка в одном ответе", async () => {
    const b = await buyer();
    const { r } = await run(b, "Сколько стоит палитра?", [
      { text: "Палитра средств выразительности — 1 700 ₸.", toolCalls: [call("show_item")] },
      { text: "Кнопка ниже 👇" },
    ]);
    const x = one(r);
    expect(x.text).toBe("Палитра средств выразительности — 1 700 ₸.\n\nКнопка ниже 👇");
    expect(x.buttons).toEqual([{ offerId: "AB12", label: "Купить: Палитра" }]);
    expect(x).toMatchObject({ source: "model", checkResult: "ok" });
  });

  it("2: в истории модель видит, что кнопка уже была показана", async () => {
    const b = await buyer();
    await run(b, "Палитра?", [{ toolCalls: [call("show_item")] }, { text: "Палитра — 1 700 ₸." }]);
    const { model } = await run(b, "На какой бумаге печатать?", [{ text: "На А4." }]);
    const sent = JSON.stringify(model.requests[0]!.messages);
    expect(sent).toContain("[показаны кнопки: Купить: Палитра]");
    expect(model.requests[0]!.system.map((s) => s.cache)).toEqual([true, true, false]);
  });

  it("3: последний круг — tool_choice none, инструменты в запросе остаются (кэш)", async () => {
    const b = await buyer();
    const { r, model } = await run(b, "покажи", [
      { toolCalls: [call("show_item")] },
      { toolCalls: [call("show_item")] },
      { toolCalls: [call("show_item")] },
      { text: "Палитра — 1 700 ₸." },
    ]);
    expect(model.requests.map((q) => q.toolChoice)).toEqual(["auto", "auto", "auto", "none"]);
    expect(model.requests.every((q) => q.tools.length === 2)).toBe(true);
    expect(one(r).source).toBe("model");
  });

  it("после передачи продавцу — круг без инструментов, только фраза", async () => {
    const b = await buyer();
    const { r, model } = await run(b, "позовите человека", [
      { toolCalls: [call("pass_to_human")] },
      { text: "Передала продавцу, он ответит здесь." },
    ]);
    expect(model.requests[1]!.toolChoice).toBe("none");
    expect(one(r).actions).toEqual([{ kind: "handoff" }]);
  });
});

describe("порядок: кто молчит и почему", () => {
  it("повтор вебхука — молчим, модель не зовём", async () => {
    const b = await buyer();
    await run(b, "привет", [{ text: "Здравствуйте!" }], { externalId: "same-1" });
    const { r, model } = await run(b, "привет", [], { externalId: "same-1" });
    expect(r).toEqual({ kind: "silent", reason: "duplicate" });
    expect(model.requests).toHaveLength(0);
  });

  it("заблокирован — молчим, деньги не тронуты", async () => {
    const b = await buyer();
    await blockBuyer(asA(), { botId: A, buyerId: b, by: "seller" });
    const before = await balance();
    const { r, model } = await run(b, "привет", []);
    expect(r).toEqual({ kind: "silent", reason: "blocked" });
    expect(model.requests).toHaveLength(0);
    expect(await balance()).toBe(before);
  });

  it("диалог у продавца — молчим", async () => {
    const b = await buyer();
    await pg.query("select v4.open_case($1, 'handoff', $2, 'ai', $3)", [A, `buyer:${b}`, b]);
    const { r } = await run(b, "ау", []);
    expect(r).toEqual({ kind: "silent", reason: "handoff" });
  });

  it("ИИ у магазина выключен — молчим (канал ведёт себя как v3)", async () => {
    const b = await buyer();
    aiEnabled = false;
    try {
      const { r, model } = await run(b, "привет", []);
      expect(r).toEqual({ kind: "silent", reason: "ai_off" });
      expect(model.requests).toHaveLength(0);
    } finally {
      aiEnabled = true;
    }
  });

  it("ход занят — молчим (queued)", async () => {
    const b = await buyer();
    await pg.query("select v4.take_turn($1, $2, gen_random_uuid())", [A, b]);
    const { r } = await run(b, "привет", []);
    expect(r).toEqual({ kind: "silent", reason: "queued" });
  });
});

describe("пределы и деньги", () => {
  it("41-е сообщение за день — простой ответ без ИИ (E05)", async () => {
    const b = await buyer();
    await pg.query(
      "update v4.buyers set ai_replies_day = 40, ai_replies_date = (now() at time zone 'Asia/Almaty')::date where id = $1",
      [b],
    );
    const { r, model } = await run(b, "ещё вопрос", []);
    expect(model.requests).toHaveLength(0);
    expect(one(r)).toMatchObject({ source: "fallback", reason: "limit_buyer", costMicroUsd: 0 });
  });

  it("расход: цена API с наценкой списана, в журнале и в книге одна цифра", async () => {
    const b = await buyer();
    const before = await balance();
    const { r } = await run(b, "привет", [{ text: "Здравствуйте!", costMicroUsd: 12_000 }]);
    const x = one(r);
    expect(x.costMicroUsd).toBe(15_000);
    expect(await balance()).toBe(before - 15_000);
    const msg = await pg.query<{ cost: string }>(
      "select cost_micro_usd cost from v4.messages where id = $1",
      [x.messageId],
    );
    expect(Number(msg.rows[0]!.cost)).toBe(15_000);
    const usage = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.ai_usage where buyer_id = $1",
      [b],
    );
    expect(usage.rows[0]!.n).toBe(1);
  });

  it("кошелёк пуст — простой ответ, модель не зовём, дело продавцу", async () => {
    const E = "eeeeeeee-0000-4000-8000-0000000003e5";
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [E]);
    const b = (
      await pg.query<{ id: string }>(
        "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
        [E],
      )
    ).rows[0]!.id;
    const model = scriptedAgentModel([]);
    const r = await runAgent({
      db: pgliteV4(pg, { botId: E }),
      role,
      model,
      markupBp: async () => 2500,
      botId: E,
      buyerId: b,
      mode: "live",
      channel: "telegram",
      externalId: "e1",
      text: "привет",
    });
    expect(model.requests).toHaveLength(0);
    expect(one(r)).toMatchObject({ source: "fallback", reason: "wallet_empty" });
  });

  it("модель упала — простой ответ, бронь возвращена целиком", async () => {
    const b = await buyer();
    const before = await balance();
    const { r } = await run(b, "привет", [{ throws: new Error("boom") }]);
    expect(one(r)).toMatchObject({ source: "fallback", reason: "model_failed" });
    expect(await balance()).toBe(before);
  });

  it("429 один раз — повтор помог; дважды — простой ответ", async () => {
    const b = await buyer();
    const busy = Object.assign(new Error("overloaded"), { status: 529 });
    const ok = await run(b, "привет", [{ throws: busy }, { text: "Здравствуйте!" }]);
    expect(one(ok.r).source).toBe("model");
    const b2 = await buyer();
    const bad = await run(b2, "привет", [{ throws: busy }, { throws: busy }]);
    expect(one(bad.r)).toMatchObject({ source: "fallback", reason: "model_failed" });
  });

  it("тень: журнал с пометкой, книга ИИ не тронута, счётчик дня не растёт", async () => {
    const b = await buyer();
    const before = await balance();
    const { r } = await run(b, "привет", [{ text: "Здравствуйте!", costMicroUsd: 12_000 }], {
      mode: "shadow",
    });
    expect(one(r).costMicroUsd).toBe(12_000);
    expect(await balance()).toBe(before);
    const row = await pg.query<{ mode: string; d: number }>(
      "select m.mode, b.ai_replies_day d from v4.messages m join v4.buyers b on b.id = m.buyer_id where m.id = $1",
      [one(r).messageId],
    );
    expect(row.rows[0]).toEqual({ mode: "shadow", d: 0 });
  });
});

describe("проверка ответа", () => {
  it("цена не из каталога — модель исправляет с замечанием, уходит исправленное", async () => {
    const b = await buyer();
    const { r, model } = await run(b, "сколько?", [
      { text: "Стоит 25 000 ₸" },
      { text: "Палитра — 1 700 ₸." },
    ]);
    expect(one(r)).toMatchObject({ text: "Палитра — 1 700 ₸.", source: "model" });
    expect(JSON.stringify(model.requests[1]!.messages.at(-1))).toMatch(/25 000/);
    expect(model.requests[1]!.toolChoice).toBe("none");
  });

  it("не исправила — простой ответ, кнопки из отклонённого ответа не показываются", async () => {
    const b = await buyer();
    const { r } = await run(b, "сколько?", [
      { text: "Стоит 25 000 ₸", toolCalls: [call("show_item")] },
      { text: "Итого 25 000 ₸" },
      { text: "Ну 30 000 ₸" },
    ]);
    expect(one(r)).toMatchObject({
      source: "fallback",
      reason: "check_failed",
      checkResult: "price_unknown",
      buttons: [],
    });
  });

  it("казахское сообщение — язык ответа казахский, русский ответ отклоняется", async () => {
    const b = await buyer();
    const { r } = await run(b, "Маған сынып жетекші папкасы керек", [
      { text: "Нажмите кнопку ниже, чтобы оформить" },
      { text: "Сынып жетекші папкасы бар, бағасы 1 700 ₸." },
    ]);
    expect(one(r).text).toMatch(/бағасы/);
  });
});

describe("сообщение во время хода — ответ и за него", () => {
  it("держатель хода отвечает вторым ответом на новое сообщение", async () => {
    const b = await buyer();
    let injected = false;
    const base = scriptedAgentModel([{ text: "Здравствуйте!" }, { text: "Палитра — 1 700 ₸." }]);
    const model = {
      requests: base.requests,
      async turn(req: Parameters<typeof base.turn>[0]) {
        if (!injected) {
          injected = true;
          await recordIncoming(asA(), {
            botId: A,
            buyerId: b,
            channel: "telegram",
            externalId: "during-turn",
            text: "и сколько стоит палитра?",
            mode: "live",
          });
        }
        return base.turn(req);
      },
    };
    const r = await runAgent({
      db: asA(),
      role,
      model,
      markupBp: async () => 2500,
      botId: A,
      buyerId: b,
      mode: "live",
      channel: "telegram",
      externalId: "first",
      text: "привет",
    });
    expect(r.kind === "reply" && r.replies.map((x) => x.text)).toEqual([
      "Здравствуйте!",
      "Палитра — 1 700 ₸.",
    ]);
    const free = await pg.query<{ t: string | null }>(
      "select turn_until t from v4.buyers where id = $1",
      [b],
    );
    expect(free.rows[0]!.t).toBeNull();
  });
});

describe("язык и история для модели", () => {
  it("язык по последнему сообщению; короткое — язык карточки", () => {
    expect(detectLang("Маған папка керек", "ru")).toBe("kk");
    expect(detectLang("Сколько стоит?", "kk")).toBe("ru");
    expect(detectLang("ок", "kk")).toBe("kk");
    expect(detectLang("How much is it?", "ru")).toBe("en");
    expect(detectLang("Narxi qancha?", "ru")).toBe("uz");
  });

  it("контакты маскируются, стороны склеиваются, начало — покупатель", () => {
    const m = toModelMessages([
      {
        id: 1,
        direction: "out",
        author: "bot",
        text: "старое",
        buttons: [],
        actions: [],
        createdAt: "",
      },
      {
        id: 2,
        direction: "in",
        author: "buyer",
        text: "мой номер +7 777 123 45 51",
        buttons: [],
        actions: [],
        createdAt: "",
      },
      {
        id: 3,
        direction: "in",
        author: "buyer",
        text: "и папка",
        buttons: [],
        actions: [],
        createdAt: "",
      },
      {
        id: 4,
        direction: "out",
        author: "seller",
        text: "Есть",
        buttons: [],
        actions: [{ kind: "offer" }],
        createdAt: "",
      },
    ]);
    expect(m).toEqual([
      { role: "user", content: "мой номер +7 7** *** ** 51\nи папка" },
      { role: "assistant", content: "[ответ продавца] Есть\n[сделано: offer]" },
    ]);
  });
});
