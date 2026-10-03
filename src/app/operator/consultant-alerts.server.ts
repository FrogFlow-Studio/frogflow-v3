import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { isConsultantVertical } from "@/core/verticals/registry";
import type { Tenant } from "@/core/tenant/types";
import {
  ENABLED_KEY,
  LAST_ERROR_KEY,
  modelAlerts,
  modelAlertText,
  type AlertMarks,
  type ClientReading,
} from "./consultant-alerts";
import { inChunks } from "@/lib/in-chunks";

/** Когда оператору писали о каждом виде сбоя модели — operator_settings, JSON. */
export const MODEL_ALERTS_KEY = "operator_consultant_model_alerts";

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

async function readMarks(): Promise<{ raw: string | null; exists: boolean; marks: AlertMarks }> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", MODEL_ALERTS_KEY)
    .maybeSingle();
  if (error) throw new Error(`operator_settings: ${error.message}`);
  let marks: AlertMarks = {};
  try {
    marks = data?.value ? (JSON.parse(data.value) as AlertMarks) : {};
  } catch {
    marks = {};
  }
  return { raw: data?.value ?? null, exists: Boolean(data), marks };
}

/**
 * Отметка «сообщено» до отправки, условной записью: два прогона крона разом
 * не пришлют одно и то же дважды. Значение маленькое (четыре даты), поэтому
 * условие — на прежнее значение целиком.
 */
async function claim(prev: { raw: string | null; exists: boolean }, value: string) {
  const db = serviceDb();
  if (!prev.exists) {
    const { error } = await db.from("operator_settings").insert({ key: MODEL_ALERTS_KEY, value });
    if (error?.code === "23505") return false;
    if (error) throw new Error(`operator_settings: ${error.message}`);
    return true;
  }
  const q = db.from("operator_settings").update({ value }).eq("key", MODEL_ALERTS_KEY);
  const { data, error } = await (
    prev.raw === null ? q.is("value", null) : q.eq("value", prev.raw)
  ).select("key");
  if (error) throw new Error(`operator_settings: ${error.message}`);
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
    const [clients, state] = await Promise.all([readings(scope), readMarks()]);
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
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
