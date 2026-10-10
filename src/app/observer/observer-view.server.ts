import { serviceDb } from "@/core/db/client.server";
import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import { todayInZone } from "@/core/preorder/preorder";
import {
  OBSERVER_CAP_KEY,
  OBSERVER_ENABLED_KEY,
  OBSERVER_PROMPT_VERSION,
  OBSERVER_STATE_KEY,
  observerLogKey,
  parseCap,
  parseEnabled,
  observerInPlan,
  parseState,
  type ObserverRunSummary,
} from "@/core/observer/observer";
import type { LogEntry } from "./observer.server";

/**
 * Страница оператора «Наблюдатель»: у кого включён, расход за день, итог
 * последнего прогона и находки за сегодня и вчера — чтобы неделю мерить
 * точность до фазы 2. Оператор — serviceDb (CLAUDE.md, правило 4).
 */
export type ObserverClientRow = {
  botId: string;
  name: string;
  enabled: boolean;
  cap: number;
  spentToday: number;
  last: ObserverRunSummary | null;
  log: Array<LogEntry & { date: string }>;
};

export async function observerOverview(): Promise<{
  version: string;
  clients: ObserverClientRow[];
}> {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  const tenants = (await tenantDirectory(true)).filter(
    (t) => t.settings.served_by === "v2" && !t.archived,
  );
  const now = new Date();
  const dates = (tz: string | undefined) => {
    const today = todayInZone(tz, now);
    const yesterday = todayInZone(tz, new Date(now.getTime() - 86_400_000));
    return { today, yesterday };
  };
  const keys = new Set<string>([OBSERVER_ENABLED_KEY, OBSERVER_CAP_KEY, OBSERVER_STATE_KEY]);
  for (const t of tenants) {
    const d = dates(t.settings.timezone);
    keys.add(observerLogKey(d.today));
    keys.add(observerLogKey(d.yesterday));
  }
  const rows = tenants.length
    ? await inChunks(
        tenants.map((t) => t.id),
        (chunk) =>
          serviceDb()
            .from("app_settings")
            .select("bot_id, key, value")
            .in("key", [...keys])
            .in("bot_id", chunk),
        "app_settings",
      )
    : [];
  const get = (id: string, key: string) =>
    rows.find((r) => r.bot_id === id && r.key === key)?.value ?? null;
  const parseLog = (raw: string | null, date: string) => {
    try {
      const v = JSON.parse(raw ?? "[]");
      return Array.isArray(v) ? (v as LogEntry[]).map((e) => ({ ...e, date })) : [];
    } catch {
      return [];
    }
  };
  const clients = tenants.map((t) => {
    const d = dates(t.settings.timezone);
    const state = parseState(get(t.id, OBSERVER_STATE_KEY), d.today);
    return {
      botId: t.id,
      name: t.name,
      enabled: parseEnabled(get(t.id, OBSERVER_ENABLED_KEY), t.id) && observerInPlan(t.plan),
      cap: parseCap(get(t.id, OBSERVER_CAP_KEY)),
      spentToday: state.spend.usd,
      last: state.last ?? null,
      log: [
        ...parseLog(get(t.id, observerLogKey(d.today)), d.today),
        ...parseLog(get(t.id, observerLogKey(d.yesterday)), d.yesterday),
      ].sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  });
  clients.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  return { version: OBSERVER_PROMPT_VERSION, clients };
}

async function upsert(botId: string, key: string, value: string) {
  const db = serviceDb();
  const at = new Date().toISOString();
  const upd = await db
    .from("app_settings")
    .update({ value, updated_at: at })
    .eq("bot_id", botId)
    .eq("key", key)
    .select("key");
  if (upd.error) throw serverFailure(`app_settings: ${upd.error.message}`);
  if (upd.data?.length) return;
  const ins = await db.from("app_settings").insert({ bot_id: botId, key, value, updated_at: at });
  if (ins.error?.code === "23505") return upsert(botId, key, value);
  if (ins.error) throw serverFailure(`app_settings: ${ins.error.message}`);
}

export async function setObserver(botId: string, p: { enabled?: boolean; cap?: number }) {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  const t = (await tenantDirectory(true)).find((x) => x.id === botId);
  if (!t) throw serverFailure("клиент не найден");
  // Клиент прежней платформы для v3 невидим (CLAUDE.md, правило 6).
  if (t.settings.served_by !== "v2") throw new Error("Клиент обслуживается прежней платформой.");
  if (p.enabled !== undefined) await upsert(botId, OBSERVER_ENABLED_KEY, String(p.enabled));
  if (p.cap !== undefined) await upsert(botId, OBSERVER_CAP_KEY, String(p.cap));
}
