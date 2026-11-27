import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { v4TurnOutcome } from "../sales-eval/v4-outcome";
import { AGENT_MODEL, anthropicAgentModel } from "@/v4/agent/anthropic.server";
import { runAgent } from "@/v4/agent/run";
import { pressBuy } from "@/v4/seller/offers";
import { sellerRole } from "@/v4/seller/role";
import { seedKopilka } from "@/v4/test/kopilka";
import { pgliteV4, v4Db } from "@/v4/test/pg";

/**
 * ИИ-продавец v4 на живой модели: те же 16 сценариев Копилки, что у v3
 * (tests/sales-eval), но путь — ядро v4 с ролью «продавец» (runAgent →
 * инструменты → предложение → pressBuy) на PGlite с миграциями v4. Каталог с
 * карточками — src/v4/test/kopilka.ts; база знаний Копилки 26.10
 * (reports/kopilka/knowledge-2026-10-26.json) — в «знания продавца».
 *
 * Стоит денег (≈0,3 $ на Sonnet 5), запускается явно:
 *   env -u ANTHROPIC_BASE_URL V4_SELLER_EVAL=1 ANTHROPIC_API_KEY=… \
 *     V4_SELLER_EVAL_KB=<knowledge.json> npx vitest run tests/integration/v4-seller-eval.test.ts
 * V4_SELLER_EVAL_BUDGET_USD — предел расхода (по умолчанию 0,25), V4_SELLER_EVAL_ONLY — id через запятую.
 */
const on = process.env.V4_SELLER_EVAL === "1" && Boolean(process.env.ANTHROPIC_API_KEY);
const BOT = "c0c0c0c0-0000-4000-8000-00000000c001";

async function seed(pg: PGlite) {
  await seedKopilka(pg, BOT);
  await pg.query(
    "insert into v4.payment_methods (bot_id, kind, country, currency, fee_bp) values ($1, 'robokassa', null, 'KZT', 300)",
    [BOT],
  );
  await pg.query(`update v4.shops set ai_features = '{"buyer": true}' where bot_id = $1`, [BOT]);
  await pg.query("select v4.ai_credit($1, 'topup', 10000000, 'прогон', 'operator')", [BOT]);
  const kbPath = process.env.V4_SELLER_EVAL_KB;
  if (kbPath) {
    const kb = JSON.parse(readFileSync(kbPath, "utf8")) as Array<{
      title: string;
      content: string;
    }>;
    for (const k of kb) {
      await pg.query(
        "insert into v4.knowledge (bot_id, question, answer, source, created_by) values ($1, $2, $3, 'manual', 'eval')",
        [BOT, k.title.slice(0, 1000), k.content.slice(0, 4000)],
      );
    }
  }
}

describe.skipIf(!on)("ИИ-продавец v4 на живой модели (Копилка)", () => {
  it("16 сценариев продаж", { timeout: 900_000 }, async () => {
    const pg = await v4Db();
    await seed(pg);
    const db = pgliteV4(pg, { botId: BOT });
    const model = anthropicAgentModel(
      process.env.ANTHROPIC_API_KEY!,
      process.env.V4_SELLER_EVAL_MODEL ?? AGENT_MODEL,
    );
    const role = sellerRole();
    let n = 0;
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
      let lastButtons: Array<{ offerId?: string; label: string }> = [];
      const turns: Array<TurnResult & { outcome: TurnOutcome }> = [];
      for (const t of s.turns) {
        const outcome: TurnOutcome = { replies: [], buttons: [], newOrders: 0, handedOff: false };
        let say: string;
        if ("click" in t) {
          say = "[нажимает «Купить»]";
          const b = lastButtons[0];
          if (b?.offerId) {
            const r = await pressBuy(db, { botId: BOT, buyerId, offerId: b.offerId });
            if (r.kind === "order") {
              outcome.newOrders = r.reused ? 0 : 1;
              outcome.replies.push(`(заказ №${r.orderNo} создан)`);
            } else
              outcome.replies.push(`(заказ не создан: ${r.kind === "refused" ? r.reason : r.was})`);
          }
        } else {
          say = t.text;
          const r = await runAgent({
            db,
            role,
            model,
            markupBp: async () => 0,
            botId: BOT,
            buyerId,
            mode: "live",
            channel: "test",
            externalId: `e${++n}`,
            text: t.text,
          });
          if (r.kind === "reply") {
            const last = r.replies.at(-1)!;
            for (const x of r.replies) {
              micro += x.costMicroUsd;
              const k = x.source + (x.reason ? `:${x.reason}` : "");
              sources[k] = (sources[k] ?? 0) + 1;
            }
            Object.assign(outcome, v4TurnOutcome({ kind: "reply", ...last }));
            lastButtons = last.buttons;
          } else {
            Object.assign(outcome, v4TurnOutcome(r));
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
        model: `v4 ${process.env.V4_SELLER_EVAL_MODEL ?? AGENT_MODEL}`,
        usd: micro / 1e6,
        snapshot:
          "Копилка (каталог с карточками, база знаний 26.10), ядро v4 + роль «продавец» на PGlite",
      }) + `\n\nИсточник ответов: ${JSON.stringify(sources)}\n`;
    writeFileSync(join(out, "report.md"), report);
    console.log(report);
    await pg.close();
    expect(results.length).toBeGreaterThan(0);
  });
});
