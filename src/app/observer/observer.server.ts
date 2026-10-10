import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import { pageAll } from "@/core/db/page";
import { todayInZone } from "@/core/preorder/preorder";
import type { Tenant } from "@/core/tenant/types";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import {
  DIALOGS_PER_CALL,
  HISTORY_PER_DIALOG,
  OBSERVER_CAP_KEY,
  OBSERVER_ENABLED_KEY,
  OBSERVER_LEASE_KEY,
  OBSERVER_LEASE_MS,
  OBSERVER_MODEL,
  OBSERVER_PROMPT_VERSION,
  OBSERVER_STATE_KEY,
  REPORT_TOOL,
  UNANSWERED_MS,
  canSignal,
  capAlertText,
  costUsd,
  dialogBlock,
  observerLogKey,
  observerSystemPrompt,
  operatorBugText,
  parseCap,
  parseEnabled,
  parseFindings,
  parseState,
  pickDialogs,
  pruneSignals,
  sellerSignalText,
  windowOf,
  type ChatLine,
  type Finding,
  type ObservedDialog,
  type ObserverRunSummary,
  type ObserverState,
  suspicion,
} from "@/core/observer/observer";
import { serverFailure } from "@/lib/server-failure";
import { previewReadonly } from "@/lib/preview";

/**
 * Прогон наблюдателя по одному клиенту (крон observer, раз в 15 минут).
 * Покупателям не пишет ничего. Один прогон на клиента за раз — аренда
 * OBSERVER_LEASE_KEY условной записью по её маленькому значению; всё
 * остальное (курсор, отметки «продавцу писали», расход) пишет только
 * держатель аренды. Отметка о сигнале ставится до отправки, поэтому повтор
 * прогона не шлёт продавцу то же самое.
 */

const CALL_TIMEOUT_MS = 40_000;
const CALL_CONCURRENCY = 3;
const PLATFORM: Record<string, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

export type LogEntry = {
  at: string;
  tid: number;
  who: string;
  kind: Finding["kind"];
  audience: Finding["audience"];
  quote: string;
  summary: string;
  reply: string;
  /** seller — ушло продавцу; held — по диалогу уже писали в этот час; failed — не ушло. */
  sent: "seller" | "held" | "failed" | "system";
  ver: string;
};

type Deps = {
  callModel?: (system: string, user: string, timeoutMs: number) => Promise<ModelAnswer>;
  notifySeller?: (ctx: TenantContext, html: string) => Promise<number>;
  alertOperator?: (html: string) => Promise<{ ok: boolean }>;
  now?: () => number;
};
type ModelAnswer = { input: unknown; usage: { input_tokens?: number; output_tokens?: number } };

async function readSetting(ctx: TenantContext, key: string): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw serverFailure(`наблюдатель: ${key}: ${error.message}`);
  return data?.value ?? null;
}

async function writeSetting(ctx: TenantContext, key: string, value: string): Promise<void> {
  const at = new Date().toISOString();
  const upd = await ctx.db
    .from("app_settings")
    .update({ value, updated_at: at })
    .eq("key", key)
    .select("key");
  if (upd.error) throw serverFailure(`наблюдатель: ${key}: ${upd.error.message}`);
  if (upd.data?.length) return;
  const ins = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key, value, updated_at: at });
  if (ins.error?.code === "23505") return writeSetting(ctx, key, value);
  if (ins.error) throw serverFailure(`наблюдатель: ${key}: ${ins.error.message}`);
}

/**
 * Взять аренду: значение — ISO окончания (меньше 40 байт), условие — на
 * прежнее значение. Занято живой арендой или проиграли гонку — null.
 */
async function takeLease(ctx: TenantContext, now: number): Promise<string | null> {
  const prev = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", OBSERVER_LEASE_KEY)
    .maybeSingle();
  if (prev.error) throw serverFailure(`наблюдатель: аренда: ${prev.error.message}`);
  const until = new Date(now + OBSERVER_LEASE_MS).toISOString();
  if (!prev.data) {
    const ins = await ctx.db.from("app_settings").insert({
      bot_id: ctx.tenant.id,
      key: OBSERVER_LEASE_KEY,
      value: until,
      updated_at: new Date(now).toISOString(),
    });
    if (ins.error?.code === "23505") return null;
    if (ins.error) throw serverFailure(`наблюдатель: аренда: ${ins.error.message}`);
    return until;
  }
  const old = prev.data.value ?? "";
  if (old && Date.parse(old) > now) return null;
  const q = ctx.db
    .from("app_settings")
    .update({ value: until, updated_at: new Date(now).toISOString() })
    .eq("key", OBSERVER_LEASE_KEY);
  const { data, error } = await (
    prev.data.value === null ? q.is("value", null) : q.eq("value", old)
  ).select("key");
  if (error) throw serverFailure(`наблюдатель: аренда: ${error.message}`);
  return data?.length ? until : null;
}

async function releaseLease(ctx: TenantContext, mine: string): Promise<void> {
  const { error } = await ctx.db
    .from("app_settings")
    .update({ value: "", updated_at: new Date().toISOString() })
    .eq("key", OBSERVER_LEASE_KEY)
    .eq("value", mine);
  if (error) console.warn(`[observer:${ctx.tenant.id}] аренда не снята: ${error.message}`);
}

function whoOf(
  c: {
    platform?: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null,
  tid: number,
) {
  const name =
    (c?.username ? `@${c.username}` : "") ||
    [c?.firstName, c?.lastName].filter(Boolean).join(" ") ||
    `id ${tid}`;
  return `${PLATFORM[c?.platform ?? "telegram"] ?? "Telegram"} · ${name}`;
}

async function loadDialog(
  ctx: TenantContext,
  tid: number,
  w: { from: string; to: string },
  now: number,
): Promise<ObservedDialog | null> {
  const hist = await ctx.db
    .from("manager_chat_messages")
    .select("id, telegram_id, sender, text, created_at")
    .eq("telegram_id", tid)
    .lte("created_at", w.to)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_PER_DIALOG);
  if (hist.error) throw serverFailure(`наблюдатель: история диалога: ${hist.error.message}`);
  const lines = (hist.data ?? [])
    .map((r) => ({
      id: String(r.id),
      telegramId: Number(r.telegram_id),
      sender: r.sender,
      text: r.text,
      at: r.created_at,
      fresh: r.created_at > w.from,
    }))
    .reverse();
  if (!lines.length) return null;
  const since = new Date(now - 3 * 86_400_000).toISOString();
  const orders = await pageAll(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, order_no, display_no, status, total, currency, created_at")
        .eq("telegram_id", tid)
        .gte("created_at", since)
        .order("id")
        .range(a, b),
    "наблюдатель: заказы покупателя",
  );
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const c = await getCustomerByTelegramId(ctx, tid).catch(() => null);
  const last = lines[lines.length - 1]!;
  const lastCustomer = [...lines].reverse().find((l) => l.sender === "customer");
  const lastManager = [...lines].reverse().find((l) => l.sender === "manager");
  const silentMs = now - Date.parse(last.at);
  const waiting =
    lastCustomer && silentMs >= UNANSWERED_MS && (!lastManager || lastManager.at < lastCustomer.at)
      ? Math.round((now - Date.parse(lastCustomer.at)) / 60_000)
      : undefined;
  return {
    telegramId: tid,
    who: whoOf(c, tid),
    lines,
    orders: orders.map((o) => ({
      no: Number(o.display_no ?? o.order_no),
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      at: o.created_at,
    })),
    ...(waiting != null ? { waitingMin: waiting } : {}),
  };
}

async function defaultCallModel(
  system: string,
  user: string,
  timeoutMs: number,
): Promise<ModelAnswer> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан");
  const res = await new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs }).messages.create({
    model: OBSERVER_MODEL,
    max_tokens: 2500,
    system,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: REPORT_TOOL.name },
    messages: [{ role: "user", content: user }],
    ...modelParams(OBSERVER_MODEL),
  } as never);
  const r = res as unknown as {
    content: Array<{ type: string; name?: string; input?: unknown }>;
    usage: ModelAnswer["usage"];
  };
  const tool = r.content.find((b) => b.type === "tool_use" && b.name === REPORT_TOOL.name);
  return { input: tool?.input ?? null, usage: r.usage };
}

export type ObserverResult = { skipped: string } | (ObserverRunSummary & { held: number });

export async function runDialogObserver(
  tenant: Tenant,
  budget: { left(): number },
  deps: Deps = {},
): Promise<ObserverResult> {
  const now = (deps.now ?? Date.now)();
  if (tenant.archived) return { skipped: "archived" };
  const ctx = tenantContext(tenant);
  if (!parseEnabled(await readSetting(ctx, OBSERVER_ENABLED_KEY), tenant.id))
    return { skipped: "off" };
  if (previewReadonly()) return { skipped: "preview" };
  const lease = await takeLease(ctx, now);
  if (!lease) return { skipped: "busy" };
  try {
    return await runLeased(ctx, budget, deps, now);
  } finally {
    await releaseLease(ctx, lease);
  }
}

async function runLeased(
  ctx: TenantContext,
  budget: { left(): number },
  deps: Deps,
  now: number,
): Promise<ObserverResult> {
  const today = todayInZone(ctx.timezone, new Date(now));
  const state: ObserverState = parseState(await readSetting(ctx, OBSERVER_STATE_KEY), today);
  const cap = parseCap(await readSetting(ctx, OBSERVER_CAP_KEY));
  const alertOperator =
    deps.alertOperator ??
    (async (html: string) =>
      (await import("@/app/operator/health-alerts.server")).sendOperatorAlert(html));
  const save = async (summary: ObserverRunSummary, cursor: string | null) => {
    state.last = summary;
    state.cursor = cursor;
    state.signals = pruneSignals(state.signals, now);
    await writeSetting(ctx, OBSERVER_STATE_KEY, JSON.stringify(state));
  };

  if (state.spend.usd >= cap) {
    if (state.capAlerted !== today) {
      state.capAlerted = today;
      await writeSetting(ctx, OBSERVER_STATE_KEY, JSON.stringify(state));
      await alertOperator(capAlertText(ctx.tenant.name, state.spend.usd, cap));
    }
    return { skipped: "cap" };
  }

  const w = windowOf(state.cursor, now);
  const windowLines = await pageAll<ChatLine>(async (a, b) => {
    const r = await ctx.db
      .from("manager_chat_messages")
      .select("id, telegram_id, sender, text, created_at")
      .gt("created_at", w.from)
      .lte("created_at", w.to)
      .order("created_at")
      .order("id")
      .range(a, b);
    return {
      error: r.error,
      data: (r.data ?? []).map((x) => ({
        id: String(x.id),
        telegramId: Number(x.telegram_id),
        sender: x.sender,
        text: x.text,
        at: x.created_at,
      })),
    };
  }, "наблюдатель: новые реплики");
  // Реплики покупателя, которым в этом окне исполнилось два часа: ответил ли кто — решит история.
  const crossed = await pageAll(
    (a, b) =>
      ctx.db
        .from("manager_chat_messages")
        .select("id, telegram_id")
        .eq("sender", "customer")
        .gt("created_at", new Date(Date.parse(w.from) - UNANSWERED_MS).toISOString())
        .lte("created_at", new Date(Date.parse(w.to) - UNANSWERED_MS).toISOString())
        .order("id")
        .range(a, b),
    "наблюдатель: ждущие ответа",
  );
  const { ids, overflow } = pickDialogs(windowLines, [
    ...new Set(crossed.map((r) => Number(r.telegram_id))),
  ]);
  const freshIds = new Set(
    windowLines.filter((l) => l.sender === "customer").map((l) => l.telegramId),
  );
  const dialogs: ObservedDialog[] = [];
  let calm = 0;
  for (const id of ids) {
    const d = await loadDialog(ctx, id, w, now);
    // Ждущий без свежих реплик идёт к модели, только если и правда молчат два часа.
    if (!d || (!freshIds.has(id) && d.waitingMin == null)) continue;
    // Обычный ход покупки модели не показываем: правила дешевле (core/observer suspicion).
    if (suspicion(d, now)) dialogs.push(d);
    else calm++;
  }
  const summary: ObserverRunSummary = {
    at: new Date(now).toISOString(),
    dialogs: dialogs.length,
    ...(calm ? { calm } : {}),
    findings: 0,
    sent: 0,
    usd: 0,
    ...(overflow ? { overflow } : {}),
  };
  if (!dialogs.length) {
    await save(summary, w.to);
    return { ...summary, held: 0 };
  }

  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const locale = await sellerLocale(ctx).catch(() => "ru" as const);
  const system = observerSystemPrompt({ shop: ctx.tenant.name, sellerLocale: locale });
  const callModel = deps.callModel ?? defaultCallModel;
  const batches: ObservedDialog[][] = [];
  for (let i = 0; i < dialogs.length; i += DIALOGS_PER_CALL)
    batches.push(dialogs.slice(i, i + DIALOGS_PER_CALL));
  const findings: Finding[] = [];
  let failed = 0;
  let lastError: string | undefined;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      const left = budget.left() - 5_000;
      if (left < 10_000 || state.spend.usd >= cap) {
        failed += batch.length;
        continue;
      }
      const user = batch.map((d) => dialogBlock(d, ctx.timezone)).join("\n\n");
      try {
        const a = await callModel(system, user, Math.min(CALL_TIMEOUT_MS, left));
        const usd = costUsd(a.usage);
        state.spend = { ...state.spend, usd: state.spend.usd + usd, calls: state.spend.calls + 1 };
        summary.usd += usd;
        findings.push(...parseFindings(a.input, new Set(batch.map((d) => d.telegramId))));
      } catch (e) {
        failed += batch.length;
        lastError = e instanceof Error ? e.message : String(e);
        console.error(`[observer:${ctx.tenant.id}] модель: ${lastError}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CALL_CONCURRENCY, batches.length) }, worker));
  summary.usd = Math.round(summary.usd * 1e6) / 1e6;
  if (failed) summary.failed = failed;
  if (lastError) summary.error = lastError.slice(0, 300);
  summary.findings = findings.length;

  // Отметки «продавцу писали» — до отправки, записью состояния: держим аренду, второго писателя нет.
  const byId = new Map(dialogs.map((d) => [d.telegramId, d]));
  const toSeller: Finding[] = [];
  const log: LogEntry[] = [];
  const nowIso = new Date(now).toISOString();
  for (const f of findings) {
    const who = byId.get(f.telegramId)?.who ?? `id ${f.telegramId}`;
    const base = {
      at: nowIso,
      tid: f.telegramId,
      who,
      kind: f.kind,
      audience: f.audience,
      quote: f.quote,
      summary: f.summary,
      reply: f.reply,
      ver: OBSERVER_PROMPT_VERSION,
    };
    if (f.audience === "system") {
      log.push({ ...base, sent: "system" });
      continue;
    }
    if (!canSignal(state.signals, f.telegramId, now)) {
      log.push({ ...base, sent: "held" });
      continue;
    }
    state.signals[String(f.telegramId)] = nowIso;
    toSeller.push(f);
    log.push({ ...base, sent: "seller" });
  }
  await save(summary, w.to);

  const notifySeller =
    deps.notifySeller ??
    (async (c: TenantContext, html: string) =>
      (await import("@/channels/telegram/notify")).notifyAdminsHtml(c, html, { kind: "question" }));
  for (const f of toSeller) {
    const d = byId.get(f.telegramId)!;
    try {
      await notifySeller(
        ctx,
        sellerSignalText(locale, f, d.who, `${ctx.appUrl}/admin/chat?c=${f.telegramId}`),
      );
      summary.sent++;
    } catch (e) {
      // Не повторяем: сообщение могло дойти (CLAUDE.md, «Внешние вызовы»).
      const entry = log.find((l) => l.tid === f.telegramId && l.sent === "seller");
      if (entry) entry.sent = "failed";
      console.error(`[observer:${ctx.tenant.id}] продавцу: ${e instanceof Error ? e.message : e}`);
    }
  }
  const bugs = findings.filter((f) => f.audience !== "seller");
  if (bugs.length)
    await alertOperator(
      operatorBugText(
        ctx.tenant.name,
        bugs.map((f) => ({ f, who: byId.get(f.telegramId)?.who ?? `id ${f.telegramId}` })),
        `${ctx.appUrl}/operator/clients/${ctx.tenant.id}`,
      ),
    ).catch(() => undefined);
  if (log.length) await appendLog(ctx, today, log);
  if (summary.sent) await save(summary, w.to);
  return { ...summary, held: log.filter((l) => l.sent === "held").length };
}

/** Журнал находок за день — для страницы оператора и разбора точности. */
async function appendLog(ctx: TenantContext, date: string, entries: LogEntry[]) {
  const key = observerLogKey(date);
  let prev: LogEntry[] = [];
  try {
    prev = JSON.parse((await readSetting(ctx, key)) ?? "[]") as LogEntry[];
  } catch {
    prev = [];
  }
  await writeSetting(ctx, key, JSON.stringify([...prev, ...entries].slice(-500)));
}

/** Журнал за день — для страницы оператора. */
export async function readObserverLog(ctx: TenantContext, date: string): Promise<LogEntry[]> {
  try {
    const v = JSON.parse((await readSetting(ctx, observerLogKey(date))) ?? "[]");
    return Array.isArray(v) ? (v as LogEntry[]) : [];
  } catch {
    return [];
  }
}
