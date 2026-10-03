import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveReady } from "./live";

/**
 * Приёмка консультанта по прайсу (шаг 19 переноса BOVI): эталонный набор на
 * живой модели и прайсе магазина. Только чтение базы — состояние диалога
 * держит прогон. Стоит денег, поэтому запускается явно:
 *
 *   PRICELIST_EVAL=1 PRICELIST_EVAL_BOT=<bot_id> npx vitest run tests/integration/pricelist-eval.test.ts
 *
 * PRICELIST_EVAL_MODEL — модель (по умолчанию Haiku 4.5), PRICELIST_EVAL_MAX_USD —
 * предел расхода (0,5 $), PRICELIST_EVAL_MIN — доля прошедших сценариев для
 * приёмки (0,8), PRICELIST_EVAL_ONLY — id сценариев через запятую.
 * Отчёт — в PRICELIST_EVAL_OUT (по умолчанию во временную папку).
 *
 * Приёмка перед переездом BOVI — короткий набор (core/consultant/pricelist/eval/
 * acceptance): PRICELIST_EVAL_SET=accept. PRICELIST_EVAL_BASELINE=<файл .json> —
 * прежний прогон или вывод набора v1 в том же формате: отчёт покажет, что
 * сломалось и что починилось. Порядок действий — docs/BOVI-ACCEPTANCE.md.
 */
const on =
  liveReady &&
  process.env.PRICELIST_EVAL === "1" &&
  Boolean(process.env.ANTHROPIC_API_KEY && process.env.PRICELIST_EVAL_BOT);

describe.skipIf(!on)("эталонный набор консультанта по прайсу", () => {
  it(
    "проходит не хуже порога приёмки",
    async () => {
      const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
      const { loadPricelistData } = await import("@/core/consultant/pricelist/engine.server");
      const { V2_EVAL_SCENARIOS } = await import("@/core/consultant/pricelist/eval/scenarios");
      const { acceptanceScenarios, compareEval, comparisonReport, evalPlan } =
        await import("@/core/consultant/pricelist/eval/acceptance");
      const { evalModelCall, evalReport, runEvalScenario } =
        await import("@/core/consultant/pricelist/eval/run.server");
      const tenant = await resolveTenant({ by: "id", value: process.env.PRICELIST_EVAL_BOT! });
      expect(tenant, "магазин не найден").toBeTruthy();
      const data = await loadPricelistData(tenantContext(tenant!));
      expect(data.catalog.length, "у магазина нет прайса").toBeGreaterThan(0);
      const model = process.env.PRICELIST_EVAL_MODEL || "claude-haiku-4-5-20251001";
      const { call, spent } = evalModelCall(process.env.ANTHROPIC_API_KEY!, model);
      const only = process.env.PRICELIST_EVAL_ONLY?.split(",").map((s) => s.trim());
      const pool =
        process.env.PRICELIST_EVAL_SET === "accept" ? acceptanceScenarios() : V2_EVAL_SCENARIOS;
      const scenarios = only ? pool.filter((s) => only.includes(s.id)) : pool;
      const plan = evalPlan(scenarios);
      console.log(`[pricelist-eval] сценариев ${plan.scenarios}, ходов ${plan.turns}`);
      const maxUsd = Number(process.env.PRICELIST_EVAL_MAX_USD ?? 0.5);
      const results = [];
      for (const s of scenarios)
        results.push(await runEvalScenario(data, s, call, { spent, maxUsd }));

      const dir = process.env.PRICELIST_EVAL_OUT || join(tmpdir(), "pricelist-eval");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ model, results }, null, 2));
      let report = evalReport(results, { model, usd: spent() });
      const baselinePath = process.env.PRICELIST_EVAL_BASELINE;
      if (baselinePath) {
        const base = JSON.parse(readFileSync(baselinePath, "utf8")) as {
          results?: Array<{ id: string; title: string; pass: boolean }>;
        };
        expect(Array.isArray(base.results), "в базовом файле нет results").toBe(true);
        report += `\n${comparisonReport(compareEval(base.results!, results), baselinePath)}`;
      }
      writeFileSync(join(dir, `${stamp}.md`), report);
      console.log(`[pricelist-eval] отчёт: ${join(dir, `${stamp}.md`)}`);

      const share = results.filter((r) => r.pass).length / Math.max(1, results.length);
      expect(share).toBeGreaterThanOrEqual(Number(process.env.PRICELIST_EVAL_MIN ?? 0.8));
    },
    30 * 60_000,
  );
});
