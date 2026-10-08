import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { isConsultantVertical } from "@/core/verticals/registry";
import type { Tenant } from "@/core/tenant/types";
import {
  ENABLED_KEY,
  LAST_ERROR_KEY,
  modelAlerts,
  modelAlertText,
  outageAlertText,
  outageStep,
  type AlertMarks,
  type ClientReading,
  type OutageMarks,
} from "./consultant-alerts";
import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";

/** Когда оператору писали о каждом виде сбоя модели — operator_settings, JSON. */
export const MODEL_ALERTS_KEY = "operator_consultant_model_alerts";
/** Эпизоды затяжного сбоя Anthropic по клиентам — operator_settings, JSON. */
export const OUTAGE_KEY = "operator_consultant_outage";

type Scope = readonly Pick<Tenant, "id" | "name" | "vertical" | "settings" | "archived">[];

/** Настройки консультанта у клиентов одним запросом (крон по всем, serviceDb). */
async function readings(tenants: Scope): Promise<ClientReading[]> {
  if (!tenants.length) return [];
  const data = await inChunks(
    tenants.map((t) => t.id),
    (chunk) =>
      serviceDb()
        .from("app_settings")
        .select("bot_id, key, value")
        .in("key", [ENABLED_KEY, LAST_ERROR_KEY])
        .in("bot_id", chunk),
    "app_settings",
  );
  const get = (id: string, key: string) =>
    data.find((r) => r.bot_id === id && r.key === key)?.value ?? null;
  return tenants.map((t) => {
    const flag = get(t.id, ENABLED_KEY);
    return {
      id: t.id,
      name: t.name,
      enabled: flag === "true" || (flag !== "false" && isConsultantVertical(t.vertical)),
      lastError: get(t.id, LAST_ERROR_KEY),
    };
  });
}

async function readMarks<T extends object = AlertMarks>(
  key = MODEL_ALERTS_KEY,
): Promise<{ raw: string | null; exists: boolean; marks: T }> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
  let marks = {} as T;
  try {
    marks = data?.value ? (JSON.parse(data.value) as T) : marks;
  } catch {
    marks = {} as T;
  }
  return { raw: data?.value ?? null, exists: Boolean(data), marks };
}

/**
 * Отметка «сообщено» до отправки, условной записью: два прогона крона разом
 * не пришлют одно и то же дважды. Значение маленькое (четыре даты), поэтому
 * условие — на прежнее значение целиком.
 */
async function claim(
  prev: { raw: string | null; exists: boolean },
  value: string,
  key = MODEL_ALERTS_KEY,
) {
  const db = serviceDb();
  if (!prev.exists) {
    const { error } = await db.from("operator_settings").insert({ key, value });
    if (error?.code === "23505") return false;
    if (error) throw serverFailure(`operator_settings: ${error.message}`);
    return true;
  }
  const q = db.from("operator_settings").update({ value }).eq("key", key);
  const { data, error } = await (
    prev.raw === null ? q.is("value", null) : q.eq("value", prev.raw)
  ).select("key");
  if (error) throw serverFailure(`operator_settings: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Прогон из крона health: клиенты v2 без архива, у кого включён консультант;
 * не бросает — итог для журнала крона.
 */
export async function runConsultantModelAlerts(
  tenants: Scope,
  now = Date.now(),
): Promise<{ sent: number; kinds: string[] } | { error: string }> {
  try {
    const scope = tenants.filter((t) => t.settings.served_by === "v2" && !t.archived);
    const clients = await readings(scope);
    const model = await modelFailureAlerts(clients, now);
    const outage = await outageAlerts(clients, now);
    return { sent: model.sent + outage, kinds: [...model.kinds, ...(outage ? ["outage"] : [])] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Деньги, ключ, лимит: раз в ALERT_EVERY_MS на вид сбоя. */
async function modelFailureAlerts(
  clients: ClientReading[],
  now: number,
): Promise<{ sent: number; kinds: string[] }> {
  const state = await readMarks();
  const alerts = modelAlerts(clients, state.marks, Boolean(env().ANTHROPIC_API_KEY?.trim()), now);
  if (!alerts.length) return { sent: 0, kinds: [] };
  const { alertChannelStatus, sendOperatorAlert } = await import("./health-alerts.server");
  // Канал не настроен — не отмечаем: сообщится, когда канал появится.
  if (!(await alertChannelStatus()).configured) return { sent: 0, kinds: [] };
  const nowIso = new Date(now).toISOString();
  const marks = { ...state.marks };
  for (const a of alerts) marks[a.kind] = nowIso;
  if (!(await claim(state, JSON.stringify(marks)))) return { sent: 0, kinds: [] };
  let sent = 0;
  const back = { ...marks };
  for (const a of alerts) {
    const r = await sendOperatorAlert(modelAlertText(a));
    if (r.ok) sent++;
    else if (state.marks[a.kind]) back[a.kind] = state.marks[a.kind];
    else delete back[a.kind];
  }
  // Не ушедшее — отметку назад, повтор на следующем прогоне.
  if (sent < alerts.length)
    await claim({ raw: JSON.stringify(marks), exists: true }, JSON.stringify(back));
  return { sent, kinds: alerts.map((a) => a.kind) };
}

/** Клиенты, у которых после `since` консультант ответил сам (журнал ответов). */
async function answeredSince(prev: OutageMarks, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of ids) {
    const since = prev[id]?.since;
    if (!since) continue;
    const { count, error } = await serviceDb()
      .from("consultant_message_runs")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", id)
      .eq("reply_kind", "reply")
      .gt("received_at", since);
    if (error) throw serverFailure(`consultant_message_runs: ${error.message}`);
    if ((count ?? 0) > 0) out.add(id);
  }
  return out;
}

/**
 * Затяжной сбой Anthropic (5xx, 529, сеть, тайм-аут дольше OUTAGE_AFTER_MS):
 * эпизоды по клиентам в operator_settings, одно сообщение на эпизод. Отметка
 * «сообщено» — условной записью до отправки; не ушло — назад.
 */
async function outageAlerts(clients: ClientReading[], now: number): Promise<number> {
  const state = await readMarks<OutageMarks>(OUTAGE_KEY);
  const tracked = clients.filter((c) => state.marks[c.id]).map((c) => c.id);
  const answered = await answeredSince(state.marks, tracked);
  const { next, due } = outageStep(clients, state.marks, answered, now);
  const nowIso = new Date(now).toISOString();
  let configured = true;
  if (due.length) {
    const { alertChannelStatus } = await import("./health-alerts.server");
    // Канал не настроен — не отмечаем: сообщится, когда канал появится.
    configured = (await alertChannelStatus()).configured;
    if (configured) for (const id of due) next[id] = { ...next[id]!, sent: nowIso };
  }
  const value = JSON.stringify(next);
  if (value === (state.raw ?? "{}")) return 0;
  if (!(await claim(state, value, OUTAGE_KEY))) return 0;
  if (!due.length || !configured) return 0;
  const { sendOperatorAlert } = await import("./health-alerts.server");
  const names = clients.filter((c) => due.includes(c.id)).map((c) => c.name);
  const since = due.map((id) => next[id]!.since).sort()[0]!;
  const r = await sendOperatorAlert(outageAlertText(names, since));
  if (r.ok) return 1;
  // Не ушло — отметку назад, повтор на следующем прогоне.
  const back: OutageMarks = {};
  for (const [id, m] of Object.entries(next))
    back[id] = due.includes(id) ? { since: m.since, last: m.last } : m;
  await claim({ raw: value, exists: true }, JSON.stringify(back), OUTAGE_KEY);
  return 0;
}
