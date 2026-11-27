import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scriptedAgentModel, type ScriptedTurn } from "../agent/model";
import { type AgentReply, type AgentResult, runAgent } from "../agent/run";
import { seedKopilka } from "../test/kopilka";
import { pgliteV4, v4Db } from "../test/pg";
import { pressBuy } from "./offers";
import { sellerContext, sellerRole } from "./role";
import { TEXTS } from "./texts";

/**
 * Роль «продавец» на ядре, настоящем Postgres (PGlite, роль арендатора) и
 * каталоге Копилки. Модель записанная: каждый тест — путь до видимого итога
 * (кнопка, заказ, дело продавцу, запись памяти), а не порядок вызовов.
 */
const K = "c0c0c0c0-0000-4000-8000-0000000007c1";
const E = "e0e0e0e0-0000-4000-8000-0000000007e2"; // Копилка с пустым кошельком
let pg: PGlite;
let ids: Map<string, string>;
const asK = () => pgliteV4(pg, { botId: K });
let n = 0;

async function buyer(bot = K, country = "KZ") {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, $2) returning id",
      [bot, country],
    )
  ).rows[0]!.id;
}
const tool = (name: string, input: Record<string, unknown> = {}) => ({
  id: `t${++n}`,
  name,
  input,
});
const id = (title: string) => {
  const v = ids.get(title);
  if (!v) throw new Error(`нет товара ${title}`);
  return v;
};

async function say(
  b: string,
  text: string,
  turns: ScriptedTurn[],
  over: { bot?: string; now?: Date } = {},
) {
  const bot = over.bot ?? K;
  const model = scriptedAgentModel(turns);
  const r = await runAgent({
    db: pgliteV4(pg, { botId: bot }),
    role: sellerRole(),
    model,
    markupBp: async () => 2500,
    botId: bot,
    buyerId: b,
    mode: "live",
    channel: "telegram",
    externalId: `m${++n}`,
    text,
    sleep: async () => undefined,
    ...(over.now ? { now: over.now } : {}),
  });
  return { r, model };
}
const one = (r: AgentResult): AgentReply => {
  if (r.kind !== "reply") throw new Error(`ожидался ответ, а не ${r.reason}`);
  return r.replies[0]!;
};
const caseCount = async (bot: string, kind: string) =>
  Number(
    (
      await pg.query<{ c: string }>(
        "select count(*) c from v4.cases where bot_id = $1 and kind = $2",
        [bot, kind],
      )
    ).rows[0]!.c,
  );

beforeAll(async () => {
  pg = await v4Db();
  ids = await seedKopilka(pg, K);
  await seedKopilka(pg, E);
  for (const bot of [K, E])
    await pg.query(`update v4.shops set ai_features = '{"buyer": true}' where bot_id = $1`, [bot]);
  await pg.query("select v4.ai_credit($1, 'topup', 5000000, 'тест', 'operator')", [K]);
}, 60_000);
afterAll(() => pg.close());

describe("флажки ИИ (021)", () => {
  it("ИИ выключен по умолчанию — ядро молчит, канал как в v3", async () => {
    const S = "f0f0f0f0-0000-4000-8000-0000000007f3";
    await seedKopilka(pg, S);
    const b = await buyer(S);
    const { r, model } = await say(b, "Сколько стоит палитра?", [], { bot: S });
    expect(r).toEqual({ kind: "silent", reason: "ai_off" });
    expect(model.requests).toHaveLength(0);
  });

  it("запись флажков условная по версии; неизвестный ключ — отказ", async () => {
    const save = (f: unknown, rev: number) =>
      asK().call("save_ai_features", { p_bot_id: K, p_features: f, p_rev: rev });
    const rev = Number(
      (
        await pg.query<{ r: number }>("select ai_features_rev r from v4.shops where bot_id = $1", [
          K,
        ])
      ).rows[0]!.r,
    );
    const f = { buyer: true, upsell: true, max_chars: 500 };
    expect((await save(f, rev))[0]!.save_ai_features).toBe(true);
    expect((await save({ buyer: false }, rev))[0]!.save_ai_features).toBe(false); // второй сотрудник со старой версией
    await expect(save({ buyer: true, discount: 10 }, rev + 1)).rejects.toThrow(/bad_status/);
    await expect(save({ buyer: "yes" }, rev + 1)).rejects.toThrow(/bad_status/);
    const c = await sellerContext(asK(), { botId: K, buyerId: await buyer() });
    expect(c.features).toEqual(f);
  });
});

describe("продажа", () => {
  it("цена и кнопка в одном ответе; нажатие — заказ, 8 нажатий — тот же заказ", async () => {
    const b = await buyer();
    const pal = id("Палитра средств выразительности");
    const { r, model } = await say(b, "Сколько стоит палитра?", [
      { toolCalls: [tool("find_products", { query: "палитра" })] },
      {
        text: "Палитра средств выразительности — 1 700 KZT, плакаты на А4 или А3.",
        toolCalls: [tool("show_offer", { product_ids: [pal] })],
      },
      { text: "Оплата Kaspi-переводом, кнопка ниже 👇" },
    ]);
    const x = one(r);
    expect(x).toMatchObject({ source: "model", checkResult: "ok" });
    expect(x.buttons).toHaveLength(1);
    expect(x.buttons[0]!.label).toBe("Купить: Палитра средств выразительности · 1 700 KZT");
    // Модель видела цену из инструмента, а не выдумала.
    expect(JSON.stringify(model.requests[1]!.messages)).toContain("1 700 KZT");

    const offerId = x.buttons[0]!.offerId!;
    const presses = await Promise.all(
      Array.from({ length: 8 }, () => pressBuy(asK(), { botId: K, buyerId: b, offerId })),
    );
    const orders = new Set(presses.map((p) => (p.kind === "order" ? p.orderId : p.kind)));
    expect(orders.size).toBe(1);
    expect(presses.filter((p) => p.kind === "order" && !p.reused)).toHaveLength(1);
  });

  it("«5, 6 и 7 класс» — одна кнопка на сумму", async () => {
    const b = await buyer();
    const [v5, v6, v7] = ["5 класс", "6 класс", "7 класс"].map((c) =>
      id(`Папка родительских собраний · ${c}`),
    );
    const { r } = await say(b, "Родительские собрания на 5, 6 и 7 класс", [
      { toolCalls: [tool("show_offer", { product_ids: [v5, v6, v7] })] },
      { text: "Три папки — 6 000 KZT вместе." },
    ]);
    const x = one(r);
    expect(x.checkResult).toBe("ok");
    expect(x.buttons.map((bt) => bt.label)).toEqual(["Купить всё (3) · 6 000 KZT"]);
  });

  it("товар с вариантами — кнопки нет, модель спрашивает вариант", async () => {
    const b = await buyer();
    const { r, model } = await say(b, "Хочу формативку по литературе", [
      {
        toolCalls: [
          tool("show_offer", {
            product_ids: [id("Формативное оценивание: русская литература (Я1)")],
          }),
        ],
      },
      { text: "Для какого класса нужна формативка?" },
    ]);
    expect(one(r).buttons).toEqual([]);
    expect(JSON.stringify(model.requests[1]!.messages)).toContain("спроси, какой нужен");
  });

  it("больше 2 кнопок в ответе не бывает", async () => {
    const b = await buyer();
    const { r } = await say(b, "Что есть для кабинета?", [
      {
        toolCalls: [
          tool("show_offer", { product_ids: [id("Палитра средств выразительности")] }),
          tool("show_offer", { product_ids: [id("Небосвод писателей")] }),
          tool("show_offer", { product_ids: [id("Лестницы «Части речи и члены предложения»")] }),
        ],
      },
      { text: "Для кабинета — палитра и небосвод." },
    ]);
    expect(one(r).buttons).toHaveLength(2);
  });

  it("цена изменилась после показа — нажатие даёт новое предложение, не заказ по старой цене", async () => {
    const b = await buyer();
    const neb = id("Небосвод писателей");
    const { r } = await say(b, "Небосвод писателей", [
      { toolCalls: [tool("show_offer", { product_ids: [neb] })] },
      { text: "Небосвод писателей — 1 500 KZT." },
    ]);
    const offerId = one(r).buttons[0]!.offerId!;
    await pg.query("update v4.products set base_price_minor = 180000 where id = $1", [neb]);
    const p = await pressBuy(asK(), { botId: K, buyerId: b, offerId });
    expect(p).toMatchObject({ kind: "new_offer", was: "price_changed" });
    expect(p.kind === "new_offer" && p.offer.totalMinor).toBe(180000);
    await pg.query("update v4.products set base_price_minor = 150000 where id = $1", [neb]);
  });

  it("отмена: свой открытый заказ — да; номер чужого — нет", async () => {
    const b = await buyer();
    const { r } = await say(b, "Палитра", [
      { toolCalls: [tool("show_offer", { product_ids: [id("Палитра средств выразительности")] })] },
      { text: "Палитра средств выразительности — 1 700 KZT." },
    ]);
    const p = await pressBuy(asK(), {
      botId: K,
      buyerId: b,
      offerId: one(r).buttons[0]!.offerId!,
    });
    if (p.kind !== "order") throw new Error("ожидался заказ");
    const other = await buyer();
    const { r: r2 } = await say(other, `Отмените заказ ${p.orderNo}`, [
      { toolCalls: [tool("cancel_order", { order_no: p.orderNo })] },
      { text: "Такого заказа у вас нет." },
    ]);
    expect(one(r2).actions).toEqual([]);
    const { r: r3 } = await say(b, `Отмените заказ ${p.orderNo}, передумала`, [
      { toolCalls: [tool("cancel_order", { order_no: p.orderNo })] },
      { text: `Заказ ${p.orderNo} отменён.` },
    ]);
    expect(one(r3).actions).toEqual([{ kind: "order_cancelled", orderNo: p.orderNo }]);
    const st = await pg.query<{ status: string }>("select status from v4.orders where id = $1", [
      p.orderId,
    ]);
    expect(st.rows[0]!.status).toBe("cancelled");
  });
});

describe("память и передача продавцу", () => {
  it("класс и страна запоминаются и видны в следующем ходе", async () => {
    const b = await buyer(K, "RU");
    await say(b, "Я из Казахстана, веду 7 класс", [
      {
        toolCalls: [
          tool("set_country", { country: "kz" }),
          tool("remember_fact", { key: "grade", value: "7" }),
        ],
      },
      { text: "Запомнила: Казахстан, 7 класс." },
    ]);
    const { model } = await say(b, "Что посоветуете?", [
      { text: "Посмотрите папку родительских собраний." },
    ]);
    const buyerBlock = model.requests[0]!.system[2]!.text;
    expect(buyerBlock).toContain("Страна покупателя: KZ");
    expect(buyerBlock).toContain("grade: 7");
  });

  it("передача продавцу: дело с сутью, кнопок нет, дальше бот молчит", async () => {
    const b = await buyer();
    const before = await caseCount(K, "handoff");
    const { r } = await say(b, "Можно поговорить с человеком?", [
      { toolCalls: [tool("hand_to_seller", { kind: "human", summary_ru: "x".repeat(500) })] },
      { text: "Конечно, продавец ответит вам здесь." },
    ]);
    const x = one(r);
    expect(x.buttons).toEqual([]);
    expect(x.actions[0]).toMatchObject({ kind: "handoff", reason: "human" });
    expect(await caseCount(K, "handoff")).toBe(before + 1);
    const reason = await pg.query<{ d: string }>(
      "select detail->>'reason' d from v4.cases where bot_id = $1 and kind = 'handoff' order by created_at desc, id desc limit 1",
      [K],
    );
    expect(reason.rows[0]!.d.startsWith("Просит продавца: ")).toBe(true);
    expect(reason.rows[0]!.d.length).toBeLessThanOrEqual(300 + "Просит продавца: ".length);
    const { r: r2 } = await say(b, "Алло?", []);
    expect(r2).toEqual({ kind: "silent", reason: "handoff" });
  });

  it("проверка не прошла дважды — вопрос продавцу, покупателю «передал»", async () => {
    const b = await buyer();
    const { r } = await say(b, "А скидка будет?", [
      { text: "Да, скидка 50% до пятницы!" },
      { text: "Скидка 50% только сегодня." },
    ]);
    const x = one(r);
    expect(x).toMatchObject({ source: "fallback", reason: "check_failed" });
    expect(x.text).toBe(TEXTS.handedOff.ru);
    expect(x.actions[0]).toMatchObject({ kind: "handoff", reason: "check_failed" });
  });
});

describe("без ИИ (кошелёк пуст)", () => {
  it("товар нашёлся — кнопки; не нашёлся — «продавец ответит», не чаще раза в 6 часов", async () => {
    const b = await buyer(E);
    const t0 = new Date("2026-11-28T10:00:00Z");
    const x1 = one((await say(b, "Хотела купить палитру", [], { bot: E, now: t0 })).r);
    expect(x1).toMatchObject({ source: "fallback", reason: "wallet_empty", text: TEXTS.found.ru });
    expect(x1.buttons[0]!.label).toContain("Палитра средств выразительности");

    const x2 = one(
      (await say(b, "добрый вечер", [], { bot: E, now: new Date(t0.getTime() + 60_000) })).r,
    );
    expect(x2.text).toBe(TEXTS.hold.ru);
    const x3 = one(
      (await say(b, "ау, есть кто", [], { bot: E, now: new Date(t0.getTime() + 2 * 3_600_000) })).r,
    );
    expect(x3.text).toBe("");
    const x4 = one(
      (await say(b, "ау, есть кто", [], { bot: E, now: new Date(t0.getTime() + 7 * 3_600_000) })).r,
    );
    expect(x4.text).toBe(TEXTS.hold.ru);
    expect(await caseCount(E, "ai_limit")).toBe(1);
  });

  it("казахское сообщение — простой ответ по-казахски", async () => {
    const b = await buyer(E);
    const x = one((await say(b, "Сәлеметсіз бе, рефлексия бар ма?", [], { bot: E })).r);
    expect(x.text).toBe(TEXTS.found.kk);
    expect(x.buttons[0]!.label.startsWith(TEXTS.buy.kk)).toBe(true);
  });
});

describe("знания (021)", () => {
  it("ответ с телефоном или суммой — на проверку; после «да» продавца бот им отвечает", async () => {
    const b = await buyer();
    const mk = async (q: string, a: string) => {
      const c = (
        await asK().call("open_case", {
          p_bot_id: K,
          p_kind: "handoff",
          p_dedupe_key: `q:${++n}`,
          p_created_by: "bot",
          p_buyer_id: b,
          p_order_id: null,
          p_detail: {},
        })
      )[0]!.case_id as string;
      return (
        await asK().call("learn_from_reply", {
          p_bot_id: K,
          p_case_id: c,
          p_question: q,
          p_answer: a,
        })
      )[0]!.learn_from_reply as string;
    };
    await mk("Можно на А3?", "Да, печатайте на А3, качество сохранится.");
    const risky = await mk("Как связаться?", "Звоните +7 701 555 12 34, спросите Айгуль.");
    await mk("Сколько за все классы?", "За все классы 16 500.");
    let c = await sellerContext(asK(), { botId: K, buyerId: b });
    expect(c.knowledge.map((k) => k.question)).toEqual(["Можно на А3?"]);
    await asK().call("review_knowledge", { p_bot_id: K, p_knowledge_id: risky, p_approve: true });
    c = await sellerContext(asK(), { botId: K, buyerId: b });
    expect(c.knowledge.map((k) => k.question)).toEqual(["Можно на А3?", "Как связаться?"]);
  });

  it("больше 30 знаний — 8 ближайших к сообщению, остальные через search_knowledge", async () => {
    const B = "b0b0b0b0-0000-4000-8000-0000000007b4";
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [B]);
    for (let i = 0; i < 35; i++)
      await pg.query(
        "insert into v4.knowledge (bot_id, question, answer, source, created_by) values ($1, $2, $3, 'manual', 'seller')",
        [B, `Вопрос ${i}`, i === 7 ? "Ламинировать плакаты не нужно." : `Ответ про тетради ${i}`],
      );
    const b = await buyer(B);
    const c = await sellerContext(pgliteV4(pg, { botId: B }), {
      botId: B,
      buyerId: b,
      query: "надо ламинировать?",
    });
    expect(c.knowledge_total).toBe(35);
    expect(c.knowledge.map((k) => k.answer)).toEqual(["Ламинировать плакаты не нужно."]);
  });
});

describe("промпт", () => {
  it("4 блока: общий и магазин в кэше, покупатель и язык — нет; анкета и часы работы на месте", async () => {
    await pg.query(
      'update v4.shops set seller_profile = seller_profile || \'{"work_hours_note": "Продавец отвечает с 9 до 21 по Алматы."}\' where bot_id = $1',
      [K],
    );
    const b = await buyer();
    const { model } = await say(b, "Сәлеметсіз бе", [
      { text: "Сәлеметсіз бе! Қандай материал керек?" },
    ]);
    const sys = model.requests[0]!.system;
    expect(sys.map((s) => s.cache)).toEqual([true, false, false, false].map((_, i) => i < 2));
    expect(sys[1]!.text).toContain("Копилка Русоведа");
    expect(sys[1]!.text).toContain("с 9 до 21");
    expect(sys[3]!.text).toContain("казахском");
    // Общий блок одинаков для любого магазина — кэш общий.
    expect(sys[0]!.text).not.toContain("Копилка");
  });
});
