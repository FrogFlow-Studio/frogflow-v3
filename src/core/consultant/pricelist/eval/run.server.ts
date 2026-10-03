import { PREVIEW_AI_OFF, previewReadonly } from "@/lib/preview";
import Anthropic from "@anthropic-ai/sdk";
import { isResetIntent } from "../../prompt";
import {
  decidePricelistReply,
  modelParams,
  type ModelCall,
  type PricelistData,
  type PricelistState,
} from "../engine.server";
import { looksLikePromptInjection } from "../finalize";
import { HANDOFF_REPLY } from "../turn.server";
import { checkTurn, indexCatalog, type EvalScenario, type Flag } from "./checks";

/**
 * Прогон эталонного набора (перенос scripts/eval-consultant-v2.ts v1) —
 * движок по прайсу на данных магазина, вызов модели настоящий. Состояние
 * диалога держит прогон, в базу ничего не пишется: ни паузы, ни задачи, ни
 * журнала, ни расхода клиента. Запускает живой тест
 * tests/integration/pricelist-eval.test.ts.
 */
export type EvalTurnResult = {
  customer: string;
  reply: string;
  historyText?: string;
  handoff: string | null;
  tools: string[];
  flags: Flag[];
  usd: number;
  skipped?: string;
};
export type EvalScenarioResult = {
  id: string;
  title: string;
  pass: boolean;
  turns: EvalTurnResult[];
};

/** Ставки за миллион токенов: ввод, вывод, запись в часовой кеш, чтение. */
const PRICE: Record<string, { in: number; out: number; cw: number; cr: number }> = {
  haiku: { in: 1, out: 5, cw: 2, cr: 0.1 },
  sonnet: { in: 3, out: 15, cw: 6, cr: 0.3 },
};

/** Вызов модели для прогона со счётчиком расхода. */
export function evalModelCall(
  apiKey: string,
  model: string,
): { call: ModelCall; spent: () => number } {
  if (previewReadonly()) throw new Error(PREVIEW_AI_OFF);
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  const p = PRICE[/sonnet/.test(model) ? "sonnet" : "haiku"]!;
  let usd = 0;
  const call: ModelCall = async (req) => {
    const res = await client.messages.create({ model, ...req, ...modelParams(model) } as never);
    const u = (res as Anthropic.Message).usage;
    usd +=
      (u.input_tokens * p.in +
        (u.cache_creation_input_tokens ?? 0) * p.cw +
        (u.cache_read_input_tokens ?? 0) * p.cr +
        u.output_tokens * p.out) /
      1_000_000;
    return res as Anthropic.Message;
  };
  return { call, spent: () => usd };
}

export async function runEvalScenario(
  data: PricelistData,
  scenario: EvalScenario,
  call: ModelCall,
  opts: { spent?: () => number; maxUsd?: number; now?: Date } = {},
): Promise<EvalScenarioResult> {
  const index = indexCatalog(data.catalog);
  const storyProductIds = scenario.storyProducts?.flatMap((part) =>
    data.catalog.filter((p) => p.name.toLowerCase().includes(part.toLowerCase())).map((p) => p.id),
  );
  let state: PricelistState = {};
  let paused = false;
  let first = true;
  const turns: EvalTurnResult[] = [];
  for (const turn of scenario.turns) {
    const base = { customer: turn.text, reply: "", handoff: null, tools: [], usd: 0 };
    if (opts.maxUsd != null && (opts.spent?.() ?? 0) >= opts.maxUsd) {
      turns.push({
        ...base,
        flags: [{ check: "бюджет", detail: "прогон остановлен по расходу" }],
        skipped: "бюджет",
      });
      continue;
    }
    if (isResetIntent(turn.text)) {
      state = {};
      paused = false;
      first = true;
      turns.push({ ...base, reply: "Начнём заново. Что подсказать?", flags: [] });
      continue;
    }
    if (paused) {
      turns.push({
        ...base,
        flags: [{ check: "пауза", detail: "диалог у менеджера — ход не выполнен" }],
        skipped: "пауза",
      });
      continue;
    }
    const before = opts.spent?.() ?? 0;
    let text: string;
    let historyText: string | undefined;
    let handoff: { reason: string; summary: string } | null = null;
    let tools: string[] = [];
    if (looksLikePromptInjection(turn.text)) {
      // Как в runConsultant: взлом — менеджеру, модель его не видит.
      text = HANDOFF_REPLY;
      handoff = { reason: "injection", summary: "" };
    } else {
      const d = await decidePricelistReply(data, {
        text: turn.text,
        state,
        call,
        now: opts.now,
        ...(storyProductIds ? { storyProductIds } : {}),
        ...(turn.imageUrl ? { imageUrls: [turn.imageUrl] } : {}),
      });
      text = d.reply || HANDOFF_REPLY;
      historyText = d.historyText !== d.reply ? d.historyText : undefined;
      handoff = d.handoff ? { reason: d.handoff.reason, summary: d.handoff.summary } : null;
      tools = d.tools;
      state = {
        ...state,
        ...d.statePatch,
        recent: [
          ...(state.recent ?? []),
          { role: "customer" as const, text: turn.text },
          { role: "assistant" as const, text: historyText ?? text },
        ].slice(-16),
      };
      if (!d.reply && !d.handoff) handoff = { reason: "no_answer", summary: "модель не ответила" };
    }
    const flags = checkTurn(
      turn,
      {
        text,
        historyText,
        kind: handoff ? "handoff" : "reply",
        handoff,
        toolsUsed: tools,
        rate: data.rate?.rate ?? null,
      },
      index,
      first,
    );
    turns.push({
      customer: turn.text,
      reply: text,
      ...(historyText ? { historyText } : {}),
      handoff: handoff?.reason ?? null,
      tools,
      flags,
      usd: (opts.spent?.() ?? 0) - before,
    });
    if (handoff) paused = true;
    first = false;
  }
  return {
    id: scenario.id,
    title: scenario.title,
    pass: turns.every((t) => t.flags.length === 0),
    turns,
  };
}

/** Отчёт в Markdown: сценарий → прошёл или нет, с замечаниями по ходам. */
export function evalReport(
  results: EvalScenarioResult[],
  meta: { model: string; usd: number },
): string {
  const passed = results.filter((r) => r.pass).length;
  const lines = [
    `# Эталонный набор консультанта по прайсу`,
    "",
    `Модель: ${meta.model}. Прошло ${passed} из ${results.length}. Расход: $${meta.usd.toFixed(2)}.`,
    "",
  ];
  for (const r of results) {
    lines.push(`## ${r.pass ? "✅" : "❌"} ${r.id} — ${r.title}`);
    for (const t of r.turns) {
      lines.push(`- **${t.customer}** → ${t.reply.replace(/\n+/g, " ⏎ ").slice(0, 300)}`);
      for (const f of t.flags) lines.push(`  - ${f.check}: ${f.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
