import type { TenantContext } from "@/core/tenant/resolve.server";
import { isMissingTable } from "@/core/community/not-ready";
import { serverFailure } from "@/lib/server-failure";
import { dayKey } from "./pure";
import { SOURCE_OTHER } from "./source-funnel";
import {
  foldVisits,
  VISIT_SOURCES_PER_DAY,
  VISIT_STAGES,
  type VisitRow,
  type VisitStage,
  type VisitsReport,
} from "./visits";

/**
 * Счётчик визитов витрины (У1). Таблица `visit_sources` (migrations/22-3) — одна
 * строка на магазин, день, источник и этап. Запись — небольшим условным
 * обновлением числа: читаем n и обновляем «где n прежнее», два визита подряд
 * не теряют друг друга; новую строку вставляет вставка (PK), проигравшая
 * гонку повторяет. Личных данных нет: ни адреса, ни браузера, ни cookie.
 * Таблицы может не быть (миграцию применяет Яков): запись молчит, чтение
 * отвечает null — «визитов нет данных», ошибок нет.
 */
/** Хватает на сотню одновременных визитов: каждый круг кто-то выигрывает. */
const TRIES = 40;

/** Случайная пауза перед повтором, чтобы проигравшие разошлись. */
const backoff = (i: number) =>
  new Promise((r) => setTimeout(r, Math.random() * Math.min(60, 4 * 2 ** i)));

export async function recordVisit(
  ctx: TenantContext,
  input: { source: string; stage: VisitStage },
  now = new Date(),
): Promise<{ counted: boolean }> {
  if (!VISIT_STAGES.includes(input.stage)) return { counted: false };
  const day = dayKey(now, ctx.timezone);
  let source = input.source.trim().slice(0, 64) || "direct";
  const missing = { counted: false };

  // Новых источников за день не больше VISIT_SOURCES_PER_DAY; остальное — «other».
  const have = await ctx.db
    .from("visit_sources")
    .select("source")
    .eq("day", day)
    .eq("stage", input.stage)
    .eq("source", source)
    .maybeSingle();
  if (have.error) {
    if (isMissingTable(have.error)) return missing;
    throw serverFailure(`Визиты: ${have.error.message}`);
  }
  if (!have.data) {
    const known = await ctx.db
      .from("visit_sources")
      .select("source", { count: "exact", head: true })
      .eq("day", day)
      .eq("stage", input.stage);
    if (known.error) throw serverFailure(`Визиты: ${known.error.message}`);
    if ((known.count ?? 0) >= VISIT_SOURCES_PER_DAY) source = SOURCE_OTHER;
  }

  for (let i = 0; i < TRIES; i++) {
    if (i > 0) await backoff(i);
    const cur = await ctx.db
      .from("visit_sources")
      .select("n")
      .eq("day", day)
      .eq("source", source)
      .eq("stage", input.stage)
      .maybeSingle();
    if (cur.error) {
      if (isMissingTable(cur.error)) return missing;
      throw serverFailure(`Визиты: ${cur.error.message}`);
    }
    if (!cur.data) {
      const ins = await ctx.db
        .from("visit_sources")
        .insert({ bot_id: ctx.tenant.id, day, source, stage: input.stage, n: 1 });
      if (!ins.error) return { counted: true };
      if (ins.error.code === "23505") continue;
      if (isMissingTable(ins.error)) return missing;
      throw serverFailure(`Визиты: ${ins.error.message}`);
    }
    const upd = await ctx.db
      .from("visit_sources")
      .update({ n: cur.data.n + 1 })
      .eq("day", day)
      .eq("source", source)
      .eq("stage", input.stage)
      .eq("n", cur.data.n)
      .select("n");
    if (upd.error) throw serverFailure(`Визиты: ${upd.error.message}`);
    if (upd.data?.length) return { counted: true };
  }
  // Гонку не выиграли за TRIES кругов: один визит не стоит ошибки, он просто не посчитан.
  return { counted: false };
}

/** Визиты за период [from, to] по дням магазина; null — таблицы ещё нет. */
export async function loadVisits(
  ctx: TenantContext,
  from: Date,
  to: Date,
): Promise<VisitsReport | null> {
  const since = dayKey(from, ctx.timezone);
  const until = dayKey(to, ctx.timezone);
  const rows: VisitRow[] = [];
  const PAGE = 1000;
  for (let from0 = 0; ; from0 += PAGE) {
    const { data, error } = await ctx.db
      .from("visit_sources")
      .select("day, source, stage, n")
      .gte("day", since)
      .lte("day", until)
      .order("day")
      .order("source")
      .order("stage")
      .range(from0, from0 + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw serverFailure(`Визиты по источникам: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return foldVisits(rows);
}
