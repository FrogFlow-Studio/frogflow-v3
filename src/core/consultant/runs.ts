import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { pageAll } from "@/core/db/page";

/**
 * Журнал ответов консультанта — строка на входящее сообщение в
 * consultant_message_runs (перенос src/lib/consultant/runs.ts v1). Даёт цену
 * одного ответа, долю кеша, число вызовов модели и что модель делала за ход —
 * без гонок за один накопительный JSON в app_settings. Upsert по
 * (bot_id, message_id): повтор доставки не плодит строк.
 *
 * Запись никогда не мешает ответу покупателю: сбой только пишется в лог.
 */
export type ConsultantRunRecord = {
  /** Id входящего у Meta или событие Zernio — ключ идемпотентности. */
  messageId: string;
  conversationId: string;
  accountId?: string | null;
  userKey: string;
  source: "webhook" | "poll" | "admin_test";
  incomingText?: string;
  replyText?: string;
  replyKind?: string | null;
  model?: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    usd: number;
  } | null;
  rate?: { value?: number | null; updatedAt?: string | null; source?: string | null } | null;
  tools?: string[];
  errorCode?: string | null;
  /** По умолчанию replied; ответ не ушёл — terminal_failed. */
  status?: "replied" | "cancelled" | "terminal_failed";
};

export async function recordConsultantRun(
  ctx: TenantContext,
  run: ConsultantRunRecord,
  now = new Date(),
): Promise<void> {
  if (!run.messageId) return;
  try {
    const at = now.toISOString();
    const status = run.status ?? (run.errorCode ? "terminal_failed" : "replied");
    const u = run.usage;
    const { error } = await ctx.db.from("consultant_message_runs").upsert(
      {
        bot_id: ctx.tenant.id,
        message_id: run.messageId.slice(0, 200),
        conversation_id: run.conversationId,
        account_id: run.accountId ?? null,
        user_key: run.userKey,
        direction: "incoming",
        source: run.source,
        status,
        incoming_text: run.incomingText?.slice(0, 2000) ?? null,
        reply_text: run.replyText?.slice(0, 4000) ?? null,
        reply_kind: run.replyKind ?? null,
        model: run.model ?? null,
        rate_value: run.rate?.value ?? null,
        rate_updated_at: run.rate?.updatedAt ?? null,
        rate_source: run.rate?.source ?? null,
        token_usage: (u
          ? {
              input: u.inputTokens,
              output: u.outputTokens,
              cache_write: u.cacheWriteTokens ?? 0,
              cache_read: u.cacheReadTokens ?? 0,
              usd: Math.round(u.usd * 1_000_000) / 1_000_000,
            }
          : {}) as Json,
        tool_trace: (run.tools?.length ? [{ tools: run.tools.slice(0, 30) }] : []) as Json,
        error_code: run.errorCode ?? null,
        sent_at: status === "replied" ? at : null,
        completed_at: at,
        updated_at: at,
      },
      { onConflict: "bot_id,message_id" },
    );
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(`[consultant:${ctx.tenant.id}] строка журнала ответов не записана`, e);
  }
}

export type ConsultantUsageDay = {
  /** Дата по поясу магазина: продавец считает сутки своими, а не по UTC. */
  date: string;
  messages: number;
  usd: number;
};

export type ConsultantUsageStats = {
  days: ConsultantUsageDay[];
  messages: number;
  usd: number;
  /** Средняя цена одного ответа, в долларах. */
  usdPerMessage: number;
  /** Доля ввода, прочитанная из кеша: при исправном кеше близка к единице. */
  cacheReadShare: number;
};

function localDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function summarizeConsultantRuns(
  rows: { received_at: string; token_usage: unknown }[],
  timeZone = "Asia/Almaty",
): ConsultantUsageStats {
  const byDate = new Map<string, ConsultantUsageDay>();
  let usd = 0;
  let input = 0;
  let cacheRead = 0;
  const num = (v: unknown) => Math.max(0, Number(v) || 0);
  for (const row of rows) {
    const u = (
      row.token_usage && typeof row.token_usage === "object" ? row.token_usage : {}
    ) as Record<string, unknown>;
    const date = localDate(row.received_at, timeZone);
    const day = byDate.get(date) ?? { date, messages: 0, usd: 0 };
    day.messages += 1;
    day.usd += num(u.usd);
    byDate.set(date, day);
    usd += num(u.usd);
    input += num(u.input) + num(u.cache_write) + num(u.cache_read);
    cacheRead += num(u.cache_read);
  }
  return {
    days: [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)),
    messages: rows.length,
    usd,
    usdPerMessage: rows.length ? usd / rows.length : 0,
    cacheReadShare: input > 0 ? cacheRead / input : 0,
  };
}

/** Сводка за последние `days` суток — продавцу в панели. */
export async function loadConsultantUsage(
  ctx: TenantContext,
  days = 7,
  now = Date.now(),
): Promise<ConsultantUsageStats> {
  const since = new Date(now - days * 86_400_000).toISOString();
  let data: { received_at: string; token_usage: unknown }[] = [];
  try {
    data = await pageAll(
      (from, to) =>
        ctx.db
          .from("consultant_message_runs")
          .select("received_at, token_usage")
          .gte("received_at", since)
          .order("received_at", { ascending: false })
          .order("id")
          .range(from, to),
      "журнал ответов не прочитан",
    );
  } catch (e) {
    console.warn(`[consultant:${ctx.tenant.id}]`, e instanceof Error ? e.message : e);
  }
  return summarizeConsultantRuns(data, ctx.timezone);
}
