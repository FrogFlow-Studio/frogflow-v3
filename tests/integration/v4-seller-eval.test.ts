import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  checkTurn,
  salesReport,
  scenarioResult,
  type SalesScenario,
  type TurnOutcome,
  type TurnResult,
} from "../sales-eval/checks";
import { SALES_SCENARIOS } from "../sales-eval/scenarios";
import { BUY_BUTTON_TITLE } from "@/channels/zernio/shop/buy-button";
import { anthropicSellerModel, SELLER_MODEL } from "@/v4/seller/anthropic.server";
import { buyNow, runSeller } from "@/v4/seller/seller";
import { pgliteV4, v4Db } from "@/v4/test/pg";

/**
 * ИИ-продавец v4 на живой модели: те же 16 сценариев Копилки, что у v3
 * (tests/sales-eval), но путь — ядро v4 (runSeller → инструменты → кнопка →
 * buyNow) на PGlite с миграциями v4. Каталог — восстановлен по базе знаний
 * Копилки 26.10 (reports/kopilka/knowledge-2026-10-26.json): в v4 у товара
 * только название, цена и варианты, описания нет, поэтому факты карточки
 * идут в «знания продавца».
 *
 * Стоит денег (≈0,3 $ на Sonnet 5), запускается явно:
 *   env -u ANTHROPIC_BASE_URL V4_SELLER_EVAL=1 ANTHROPIC_API_KEY=… \
 *     V4_SELLER_EVAL_KB=<knowledge.json> npx vitest run tests/integration/v4-seller-eval.test.ts
 * V4_SELLER_EVAL_BUDGET_USD — предел расхода (по умолчанию 0,25), V4_SELLER_EVAL_ONLY — id через запятую.
 */
const on = process.env.V4_SELLER_EVAL === "1" && Boolean(process.env.ANTHROPIC_API_KEY);
const BOT = "c0c0c0c0-0000-4000-8000-00000000c001";

type Item = { title: string; price: number; variants?: Array<[string, number]> };
const CATALOG: Item[] = [
  { title: "Лестницы «Части речи и члены предложения»", price: 2000 },
  { title: "Палитра средств выразительности", price: 1700 },
  { title: "Небосвод писателей", price: 1500 },
  { title: "Папка классного руководителя", price: 3500 },
  {
    title: "Папка МО классных руководителей",
    price: 2500,
    variants: [
      ["Казахстан", 2500],
      ["Россия", 2500],
    ],
  },
  {
    title: "Папка МО ЕМН",
    price: 3500,
    variants: [
      ["Казахстан", 3500],
      ["Россия", 3500],
    ],
  },
  {
    title: "Папка МО ОГН",
    price: 3500,
    variants: [
      ["Казахстан", 3500],
      ["Россия", 3500],
    ],
  },
  {
    title: "Папка родительских собраний",
    price: 2000,
    variants: [
      ...[5, 6, 7, 8, 9, 10, 11].map((c) => [`${c} класс`, 2000] as [string, number]),
      ["5–11 классы", 10000],
    ],
  },
  {
    title: "Формативное оценивание: русский язык (Я1)",
    price: 2500,
    variants: [
      ...[5, 6, 7, 8, 9].map((c) => [`${c} класс`, 2500] as [string, number]),
      ["10 класс", 2000],
      ["11 класс", 2000],
      ["5–11 классы", 16500],
    ],
  },
  {
    title: "Формативное оценивание: русская литература (Я1)",
    price: 2500,
    variants: [
      ...[5, 6, 7, 8, 9, 10, 11].map((c) => [`${c} класс`, 2500] as [string, number]),
      ["5–11 классы", 17500],
    ],
  },
  { title: "Рефлексия в национальном стиле", price: 2000 },
];

async function seed(pg: PGlite) {
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [BOT]);
  await pg.query("update v4.shops set seller_profile = $2 where bot_id = $1", [
    BOT,
    {
      shop_name: "Копилка Русоведа",
      about:
        "Электронные материалы для учителей русского языка и литературы и классных руководителей: наглядности, папки, формативное оценивание.",
      payment_terms:
        "Kaspi-перевод по реквизитам с чеком (файл после подтверждения чека) или картой по ссылке (файл сразу).",
      delivery_terms: "Файл приходит в этот чат; бумажной продукции нет.",
      tone: "Тёплый, коротко, на «вы».",
    },
  ]);
  await pg.query(
    "insert into v4.payment_methods (bot_id, kind, country, currency, details) values ($1, 'transfer', 'KZ', 'KZT', 'Kaspi Gold 4400 0000 0000 0000, Кристина К.')",
    [BOT],
  );
  await pg.query(
    "insert into v4.payment_methods (bot_id, kind, country, currency, fee_bp) values ($1, 'robokassa', null, 'KZT', 300)",
    [BOT],
  );
  for (const it of CATALOG) {
    const parent = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, kind, title, base_price_minor) values ($1, 'file', $2, $3) returning id",
        [BOT, it.title, it.price * 100],
      )
    ).rows[0]!.id;
    for (const [label, price] of it.variants ?? []) {
      await pg.query(
        "insert into v4.products (bot_id, kind, title, variant_label, parent_id, base_price_minor) values ($1, 'file', $2, $3, $4, $5)",
        [BOT, it.title, label, parent, price * 100],
      );
    }
  }
  const kbPath = process.env.V4_SELLER_EVAL_KB;
  if (kbPath) {
    const kb = JSON.parse(readFileSync(kbPath, "utf8")) as Array<{
      title: string;
      content: string;
    }>;
    for (const k of kb) {
      await pg.query(
        "insert into v4.knowledge (bot_id, question, answer, source, created_by) values ($1, $2, $3, 'manual', 'eval')",
        [BOT, k.title, k.content],
      );
    }
  }
}

describe.skipIf(!on)("ИИ-продавец v4 на живой модели (Копилка)", () => {
  it("16 сценариев продаж", { timeout: 900_000 }, async () => {
    const pg = await v4Db();
    await seed(pg);
    const db = pgliteV4(pg, { botId: BOT });
    const model = anthropicSellerModel(
      process.env.ANTHROPIC_API_KEY!,
      process.env.V4_SELLER_EVAL_MODEL ?? SELLER_MODEL,
    );
    const budgetUsd = Number(process.env.V4_SELLER_EVAL_BUDGET_USD ?? "0.25");
    const only = process.env.V4_SELLER_EVAL_ONLY?.split(",");
    const scenarios: SalesScenario[] = SALES_SCENARIOS.filter((s) => !only || only.includes(s.id));
    let micro = 0;
    const results = [];
    const sources: Record<string, number> = {};
    for (const s of scenarios) {
      if (micro / 1e6 > budgetUsd) break;
      const lang = s.locale === "kk" ? "kk" : "ru";
      const buyerId = (
        await pg.query<{ id: string }>(
          "insert into v4.buyers (bot_id, country, language) values ($1, 'KZ', $2) returning id",
          [BOT, lang],
        )
      ).rows[0]!.id;
      const history: Anthropic.MessageParam[] = [];
      let lastButtons: Array<{ productId: string; label: string }> = [];
      const turns: Array<TurnResult & { outcome: TurnOutcome }> = [];
      for (const t of s.turns) {
        const outcome: TurnOutcome = { replies: [], buttons: [], newOrders: 0, handedOff: false };
        let say: string;
        if ("click" in t) {
          say = "[нажимает «Купить»]";
          const b = lastButtons[0];
          if (b) {
            const r = await buyNow(db, {
              botId: BOT,
              buyerId,
              productId: b.productId,
              country: "KZ",
            });
            if (r.ok) {
              outcome.newOrders = 1;
              outcome.replies.push(`(заказ №${r.value.no} создан)`);
            } else outcome.replies.push(`(заказ не создан: ${r.code})`);
          }
        } else {
          say = t.text;
          const r = await runSeller({ db, model, botId: BOT, buyerId, history, text: t.text });
          if (r.kind === "reply") {
            micro += r.costMicroUsd;
            sources[r.source + (r.fallbackReason ? `:${r.fallbackReason}` : "")] =
              (sources[r.source + (r.fallbackReason ? `:${r.fallbackReason}` : "")] ?? 0) + 1;
            outcome.replies.push(r.text);
            // Кнопки в v4 называются «Купить: <товар>»; для мерила v3 — заголовок кнопки v3.
            outcome.buttons = r.buttons.map(() => BUY_BUTTON_TITLE.ru);
            lastButtons = r.buttons;
            outcome.handedOff = r.actions.some((a) => a.kind === "handoff");
            history.push({ role: "user", content: t.text });
            history.push({ role: "assistant", content: r.text || "…" });
          } else {
            outcome.handedOff = true;
          }
        }
        const flags = checkTurn(outcome, t.expect);
        turns.push({
          say,
          replies: outcome.replies,
          buttons: lastButtons.length && !("click" in t) ? lastButtons.map((b) => b.label) : [],
          flags,
          outcome,
        });
      }
      results.push(scenarioResult(s, turns));
    }
    const out = process.env.V4_SELLER_EVAL_OUT ?? join(tmpdir(), "v4-seller-eval");
    mkdirSync(out, { recursive: true });
    const report =
      salesReport(results, {
        model: `v4 ${process.env.V4_SELLER_EVAL_MODEL ?? SELLER_MODEL}`,
        usd: micro / 1e6,
        snapshot: "Копилка (каталог по базе знаний 26.10), ядро v4 на PGlite",
      }) + `\n\nИсточник ответов: ${JSON.stringify(sources)}\n`;
    writeFileSync(join(out, "report.md"), report);
    console.log(report);
    await pg.close();
    expect(results.length).toBeGreaterThan(0);
  });
});
