import { V2_EVAL_SCENARIOS } from "./scenarios";
import type { EvalScenario } from "./checks";

/**
 * Приёмка консультанта по прайсу перед переездом BOVI (шаг 19 BOVI-PORT.md):
 * короткий набор из полного эталонного — по одному-два сценария на каждый вид
 * вопроса, чтобы прогон на живой модели стоил копейки, а охват остался.
 * Весь набор (`V2_EVAL_SCENARIOS`) гоняется при правках промпта и кода.
 */
export const ACCEPTANCE_IDS = [
  // подбор и широкие вопросы
  "gift-towels",
  "what-do-you-have",
  "pillows-sleep",
  "bath-mats-prices",
  // опечатки
  "typo-paltetsa",
  "typos-mats-bedding",
  // цены и рубли по курсу
  "rub-exact-product",
  "russia-mat",
  "blanket-rub",
  // доставка: что обещать нельзя
  "delivery-rf",
  "delivery-israel",
  "moscow-delivery-prices",
  // факты из базы знаний
  "uchino-density",
  "italian-brands",
  "portuguese",
  "aquanova-compare",
  // язык и тон
  "greeting",
  "kazakh",
  "expensive",
  "thanks",
  // передача менеджеру
  "wholesale",
  "purchase",
  "photo",
  "human",
  "complaint",
  // публикации, фото и сложные подборы
  "story-price",
  "photo-towel",
  "family-bedding",
  "topper-height-waterproof",
  // защита
  "injection",
] as const;

export function acceptanceScenarios(
  all: readonly EvalScenario[] = V2_EVAL_SCENARIOS,
): EvalScenario[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  return ACCEPTANCE_IDS.map((id) => byId.get(id)).filter((s): s is EvalScenario => Boolean(s));
}

/** Сколько сценариев и ходов (≈ вызовов модели) в прогоне — до траты денег. */
export function evalPlan(scenarios: readonly EvalScenario[]): { scenarios: number; turns: number } {
  return { scenarios: scenarios.length, turns: scenarios.reduce((n, s) => n + s.turns.length, 0) };
}

type ResultLike = { id: string; title: string; pass: boolean };
export type EvalComparison = {
  /** Сценарии, которые есть и в базовом прогоне, и в новом. */
  same: Array<{ id: string; title: string; before: boolean; after: boolean }>;
  regressed: string[];
  fixed: string[];
  /** Только в одном из прогонов — сравнить нечем. */
  onlyBefore: string[];
  onlyAfter: string[];
};

/**
 * Новый прогон против базового (прежний прогон v2 или вывод набора v1 в том же
 * формате `{ results: [{ id, title, pass }] }`): что сломалось, что починилось.
 */
export function compareEval(before: ResultLike[], after: ResultLike[]): EvalComparison {
  const b = new Map(before.map((r) => [r.id, r]));
  const a = new Map(after.map((r) => [r.id, r]));
  const same = [...a.values()]
    .filter((r) => b.has(r.id))
    .map((r) => ({ id: r.id, title: r.title, before: b.get(r.id)!.pass, after: r.pass }));
  return {
    same,
    regressed: same.filter((s) => s.before && !s.after).map((s) => s.id),
    fixed: same.filter((s) => !s.before && s.after).map((s) => s.id),
    onlyBefore: [...b.keys()].filter((id) => !a.has(id)),
    onlyAfter: [...a.keys()].filter((id) => !b.has(id)),
  };
}

export function comparisonReport(c: EvalComparison, baseLabel: string): string {
  const mark = (ok: boolean) => (ok ? "✅" : "❌");
  const lines = [
    `## Сравнение с ${baseLabel}`,
    "",
    `Общих сценариев: ${c.same.length}. Сломалось: ${c.regressed.length}. Починилось: ${c.fixed.length}.`,
    "",
  ];
  if (c.same.length > 0) {
    lines.push("| Сценарий | Было | Стало |", "|---|---|---|");
    for (const s of c.same)
      lines.push(`| ${s.id} — ${s.title} | ${mark(s.before)} | ${mark(s.after)} |`);
    lines.push("");
  }
  if (c.onlyBefore.length) lines.push(`Только в базовом прогоне: ${c.onlyBefore.join(", ")}.`, "");
  if (c.onlyAfter.length) lines.push(`Только в новом прогоне: ${c.onlyAfter.join(", ")}.`, "");
  return lines.join("\n");
}
