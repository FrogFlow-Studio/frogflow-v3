import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../test/pg";
import { scriptedModel, type SellerModel } from "./model";
import { buildSellerPrompt, parseProfile } from "./prompt";
import { buyNow, runSeller } from "./seller";

/**
 * ИИ-продавец v4 на настоящем Postgres (PGlite) и записанной модели: живую
 * модель тесты не зовут (Яков 02.11: без живых прогонов). Сценарии — из
 * разбора Копилки 25.10: покупатель называет товар, бот говорит цену и
 * «Оформляем заказ?», 18 из 25 замолкают. В v4 вместо вопроса — кнопка.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000d1";
const B = "bbbbbbbb-0000-4000-8000-0000000000d2";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });

let notebook: string;
let atlas: string;
let atlas7: string;

async function product(bot: string, fields: Record<string, unknown>): Promise<string> {
  const all = { bot_id: bot, kind: "file", ...fields };
  const cols = Object.keys(all);
  const r = await pg.query<{ id: string }>(
    `insert into v4.products (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    cols.map((c) => (all as Record<string, unknown>)[c]),
  );
  return r.rows[0]!.id;
}
async function buyer(bot = A, country = "KZ", language: string | null = null) {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country, language) values ($1, $2, $3) returning id",
      [bot, country, language],
    )
  ).rows[0]!.id;
}
const usage = async (b: string) =>
  Number(
    (
      await pg.query<{ n: number }>("select count(*)::int n from v4.ai_usage where buyer_id = $1", [
        b,
      ])
    ).rows[0]!.n,
  );
const openCases = async (kind: string) =>
  Number(
    (
      await pg.query<{ n: number }>(
        "select count(*)::int n from v4.cases where bot_id = $1 and kind = $2 and status = 'open'",
        [A, kind],
      )
    ).rows[0]!.n,
  );
const call = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  id,
  name,
  input,
});

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B]) {
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
  }
  await pg.query("update v4.shops set seller_profile = $2 where bot_id = $1", [
    A,
    {
      shop_name: "Копилка",
      about: "Материалы для учителей",
      payment_terms: "Kaspi-перевод, потом чек",
      delivery_terms: "Файл приходит сюда после подтверждения оплаты",
    },
  ]);
  await pg.query(
    "insert into v4.payment_methods (bot_id, kind, country, currency, details) values ($1, 'transfer', 'KZ', 'KZT', 'Kaspi 8 700 000 00 00')",
    [A],
  );
  notebook = await product(A, { title: "Рабочая тетрадь 5 класс", base_price_minor: 450000 });
  atlas = await product(A, { title: "Атлас", base_price_minor: 300000 });
  atlas7 = await product(A, {
    title: "Атлас",
    variant_label: "7 класс",
    parent_id: atlas,
    base_price_minor: 300000,
  });
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("runSeller: товар назван → цена и кнопка «Купить» (решение 8)", () => {
  it("вместо «Оформляем заказ?» под ответом кнопка, расход ИИ записан", async () => {
    const b = await buyer();
    const model = scriptedModel([
      { toolCalls: [call("t1", "find_products", { query: "Рабочая тетрадь 5 класс" })] },
      {
        toolCalls: [
          call("t2", "payment_methods"),
          call("t3", "offer_card", { product_id: notebook }),
        ],
      },
      { text: "Тетрадь 5 класс — 4 500 KZT, оплата Kaspi-переводом. Нажмите «Купить» ниже." },
    ]);
    const r = await runSeller({
      db: asA(),
      model,
      botId: A,
      buyerId: b,
      history: [],
      text: "Нужна рабочая тетрадь 5 класс",
    });
    expect(r.kind).toBe("reply");
    if (r.kind !== "reply") return;
    expect(r.source).toBe("model");
    expect(r.buttons).toEqual([
      {
        kind: "buy",
        productId: notebook,
        title: "Рабочая тетрадь 5 класс",
        label: "Купить: Рабочая тетрадь 5 класс",
      },
    ]);
    expect(r.costMicroUsd).toBe(3 * 2500);
    expect(await usage(b)).toBe(3);

    // Модель видела настоящие цены и способы из базы, а условия — из анкеты.
    expect(model.requests[0]!.system).toContain("Kaspi-перевод, потом чек");
    const seen = JSON.stringify(model.requests[1]!.messages.at(-1));
    expect(seen).toContain("4 500 KZT");
    const seen2 = JSON.stringify(model.requests[2]!.messages.at(-1));
    expect(seen2).toContain("transfer");
    expect(seen2).not.toContain("8 700 000"); // реквизиты — после «Купить», не в переписке модели

    // Нажатие кнопки — заказ в тенге на ту же сумму.
    const o = await buyNow(asA(), { botId: A, buyerId: b, productId: notebook, country: "KZ" });
    expect(o.ok && o.value.totalMinor).toBe(450000);
    expect(o.ok && o.value.currency).toBe("KZT");
  });

  it("у товара есть варианты — кнопки на родителя нет, модель переспрашивает", async () => {
    const b = await buyer();
    const model = scriptedModel([
      { toolCalls: [call("t1", "offer_card", { product_id: atlas })] },
      { toolCalls: [call("t2", "offer_card", { product_id: atlas7 })] },
      { text: "Атлас 7 класс — 3 000 KZT." },
    ]);
    const r = await runSeller({
      db: asA(),
      model,
      botId: A,
      buyerId: b,
      history: [],
      text: "Атлас",
    });
    expect(JSON.stringify(model.requests[1]!.messages.at(-1))).toContain("варианты");
    expect(r.kind === "reply" && r.buttons.map((x) => x.title)).toEqual(["Атлас · 7 класс"]);
  });

  it("чужой товар кнопкой не показать: RLS второго магазина его не видит", async () => {
    const b = await buyer(B);
    const model = scriptedModel([
      { toolCalls: [call("t1", "offer_card", { product_id: notebook })] },
      { text: "Такого товара нет." },
    ]);
    const r = await runSeller({
      db: asB(),
      model,
      botId: B,
      buyerId: b,
      history: [],
      text: "тетрадь",
    });
    expect(r.kind === "reply" && r.buttons).toEqual([]);
  });

  it("кнопок не больше трёх, повтор того же товара — одна кнопка", async () => {
    const b = await buyer();
    const extra = await product(A, { title: "Прописи", base_price_minor: 100000 });
    const extra2 = await product(A, { title: "Карточки", base_price_minor: 100000 });
    const model = scriptedModel([
      {
        toolCalls: [
          call("a", "offer_card", { product_id: notebook }),
          call("b", "offer_card", { product_id: notebook }),
          call("c", "offer_card", { product_id: atlas7 }),
          call("d", "offer_card", { product_id: extra }),
          call("e", "offer_card", { product_id: extra2 }),
        ],
      },
      { text: "Вот." },
    ]);
    const r = await runSeller({ db: asA(), model, botId: A, buyerId: b, history: [], text: "всё" });
    expect(r.kind === "reply" && r.buttons.map((x) => x.productId)).toEqual([
      notebook,
      atlas7,
      extra,
    ]);
  });
});

describe("runSeller: продавцу, знания, кабинет", () => {
  it("передал продавцу — фраза покупателю, дальше бот молчит; ответ продавца становится знанием", async () => {
    const b = await buyer();
    const model = scriptedModel([
      { toolCalls: [call("t1", "hand_to_seller", { reason: "Есть ли тетрадь на казахском?" })] },
      { text: "Уточню у продавца и вернусь с ответом." },
    ]);
    const r = await runSeller({
      db: asA(),
      model,
      botId: A,
      buyerId: b,
      history: [],
      text: "Есть на казахском?",
    });
    expect(r.kind === "reply" && r.text).toBe("Уточню у продавца и вернусь с ответом.");
    expect(r.kind === "reply" && r.actions[0]?.kind).toBe("handoff");
    expect(model.requests[1]!.tools).toEqual([]);

    const silent = await runSeller({
      db: asA(),
      model: scriptedModel([]),
      botId: A,
      buyerId: b,
      history: [],
      text: "Ау?",
    });
    expect(silent).toEqual({ kind: "silent", reason: "handoff" });

    const caseId =
      r.kind === "reply" && r.actions[0]?.kind === "handoff" ? r.actions[0].caseId : "";
    const k = await asA().call("learn_from_reply", {
      p_bot_id: A,
      p_case_id: caseId,
      p_question: "Есть ли тетрадь на казахском?",
      p_answer: "Да, есть отдельная тетрадь на казахском языке.",
    });
    expect(k[0]!.learn_from_reply).toBeTruthy();
    // Повтор ответа продавца — то же знание, не второе.
    const k2 = await asA().call("learn_from_reply", {
      p_bot_id: A,
      p_case_id: caseId,
      p_question: "x",
      p_answer: "y",
    });
    expect(k2[0]!.learn_from_reply).toBe(k[0]!.learn_from_reply);

    const next = scriptedModel([{ text: "Да, есть." }]);
    const again = await runSeller({
      db: asA(),
      model: next,
      botId: A,
      buyerId: b,
      history: [],
      text: "Так есть на казахском?",
    });
    expect(again.kind).toBe("reply");
    expect(next.requests[0]!.system).toContain("Да, есть отдельная тетрадь на казахском языке.");
  });

  it("потерял файл — ссылка в кабинет приложена к ответу, токен не уходит в модель", async () => {
    const b = await buyer();
    const model = scriptedModel([
      { toolCalls: [call("t1", "cabinet_link")] },
      { text: "Все ваши покупки — по кнопке ниже." },
    ]);
    const r = await runSeller({
      db: asA(),
      model,
      botId: A,
      buyerId: b,
      history: [],
      text: "потеряла файл",
    });
    const link = r.kind === "reply" ? r.actions.find((a) => a.kind === "cabinet_link") : undefined;
    expect(link && link.kind === "cabinet_link" && link.token.length).toBeGreaterThan(20);
    if (link?.kind === "cabinet_link")
      expect(JSON.stringify(model.requests[1]!.messages)).not.toContain(link.token);
  });

  it("не может заплатить — дело продавцу с причиной", async () => {
    const b = await buyer(A, "BY");
    const before = await openCases("cant_pay");
    const model = scriptedModel([
      { toolCalls: [call("t1", "payment_methods")] },
      { toolCalls: [call("t2", "cant_pay", { reason: "Беларусь, нет способа оплаты" })] },
      { text: "Передала продавцу, он предложит способ оплаты." },
    ]);
    await runSeller({ db: asA(), model, botId: A, buyerId: b, history: [], text: "Я из Минска" });
    // Перевод только для KZ — белорусу модель не может его предложить.
    expect(JSON.stringify(model.requests[1]!.messages.at(-1))).toContain('\\"methods\\":[]');
    expect(await openCases("cant_pay")).toBe(before + 1);
  });

  it("открытые заказы покупателя видны с деньгами из книги", async () => {
    const b = await buyer();
    const o = await buyNow(asA(), { botId: A, buyerId: b, productId: notebook, country: "KZ" });
    const model = scriptedModel([
      { toolCalls: [call("t1", "order_status")] },
      { text: "Заказ ждёт оплаты." },
    ]);
    await runSeller({ db: asA(), model, botId: A, buyerId: b, history: [], text: "где мой заказ" });
    const seen = JSON.stringify(model.requests[1]!.messages.at(-1));
    expect(seen).toContain(`\\"no\\":${o.ok ? o.value.no : -1}`);
    expect(seen).toContain("unpaid");
  });
});

describe("runSeller: без модели", () => {
  it("модель упала — простой ответ: найденный товар с кнопкой, на языке покупателя", async () => {
    const b = await buyer(A, "KZ", "kk");
    const broken: SellerModel = {
      turn: async () => {
        throw new Error("529 overloaded");
      },
    };
    const r = await runSeller({
      db: asA(),
      model: broken,
      botId: A,
      buyerId: b,
      history: [],
      text: "Рабочая тетрадь",
    });
    expect(r.kind === "reply" && r.source).toBe("fallback");
    expect(r.kind === "reply" && r.fallbackReason).toBe("model_failed");
    expect(r.kind === "reply" && r.text).toContain("Сатып алу");
    expect(r.kind === "reply" && r.buttons.map((x) => x.productId)).toEqual([notebook]);
    expect(await usage(b)).toBe(0);
  });

  it("модель не уложилась в бюджет — простой ответ, а не зависание", async () => {
    const b = await buyer();
    const slow: SellerModel = {
      turn: (req) =>
        new Promise((_, reject) =>
          req.signal.addEventListener("abort", () => reject(req.signal.reason)),
        ),
    };
    const t0 = Date.now();
    const r = await runSeller({
      db: asA(),
      model: slow,
      botId: A,
      buyerId: b,
      history: [],
      text: "привет",
      budgetMs: 200,
    });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.kind === "reply" && r.fallbackReason).toBe("model_failed");
    expect(r.kind === "reply" && r.buttons).toEqual([]); // слово «привет» товара не нашло
  });

  it("лимит ИИ кончился — модель не зовётся, дело «ИИ-лимит» одно на месяц", async () => {
    await pg.query("update v4.shops set ai_monthly_limit_micro_usd = 0 where bot_id = $1", [A]);
    try {
      const b = await buyer();
      const model = scriptedModel([]);
      const r1 = await runSeller({
        db: asA(),
        model,
        botId: A,
        buyerId: b,
        history: [],
        text: "тетрадь",
      });
      await runSeller({ db: asA(), model, botId: A, buyerId: b, history: [], text: "атлас" });
      expect(model.requests).toHaveLength(0);
      expect(r1.kind === "reply" && r1.fallbackReason).toBe("ai_limit");
      expect(r1.kind === "reply" && r1.buttons.map((x) => x.productId)).toEqual([notebook]);
      expect(await openCases("ai_limit")).toBe(1);
    } finally {
      await pg.query("update v4.shops set ai_monthly_limit_micro_usd = 5000000 where bot_id = $1", [
        A,
      ]);
      await pg.query(
        "select v4.close_case($1, id, 'тест', 'test') from v4.cases where bot_id = $1 and kind = 'ai_limit' and status = 'open'",
        [A],
      );
    }
  });

  it("вызов, который съел остаток лимита, открывает дело сам", async () => {
    await pg.query("update v4.shops set ai_monthly_limit_micro_usd = 1 where bot_id = $1", [B]);
    const b = await buyer(B);
    await runSeller({
      db: asB(),
      model: scriptedModel([{ text: "Здравствуйте!" }]),
      botId: B,
      buyerId: b,
      history: [],
      text: "привет",
    });
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.cases where bot_id = $1 and kind = 'ai_limit' and status = 'open'",
      [B],
    );
    expect(n.rows[0]!.n).toBe(1);
  });

  it("продавец не может поднять себе лимит ИИ: колонку меняет только сервисная роль", async () => {
    await expect(
      pg.transaction(async (tx) => {
        await tx.query("set local role tenant_bot");
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ role: "tenant_bot", bot_id: A }),
        ]);
        await tx.query(
          "update v4.shops set ai_monthly_limit_micro_usd = 999999999 where bot_id = $1",
          [A],
        );
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("промпт", () => {
  it("пустая анкета так и сказана — модель не придумывает условия", () => {
    const s = buildSellerPrompt({
      profile: parseProfile({}),
      knowledge: [],
      country: null,
      lang: "uz",
    });
    expect(s).toContain("Оплата: в анкете не заполнено.");
    expect(s).toContain("узбекском");
    expect(s).not.toContain("Оформляем заказ?»\n");
  });
});
