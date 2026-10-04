import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { THRESHOLD, parseAlertStates } from "@/app/operator/health-alerts";
import { listCronStatus } from "@/app/operator/cron-status.server";
import { overallState, serviceStatuses, type Signal } from "./status";

/** Сколько снимков здоровья берём как «сейчас»: последние 30 минут (раз в 15 минут пишется один). */
const FRESH_MS = 30 * 60_000;
/** Бот-сбой считаем сбоем платформы, когда упала четверть ботов и не меньше двух: один клиент с отозванным токеном — не авария. */
const DEGRADED_SHARE = 0.25;
const DEGRADED_MIN = 2;

/** Доля упавших ботов в свежих снимках → состояние службы Telegram. Чистое правило. */
export function telegramState(total: number, failing: number): Signal["state"] {
  if (total === 0) return "unknown";
  return failing >= DEGRADED_MIN && failing / total >= DEGRADED_SHARE ? "degraded" : "ok";
}

async function telegramSignal(now: Date): Promise<Signal> {
  try {
    const since = new Date(now.getTime() - FRESH_MS).toISOString();
    // Берём только `ok` и время: ни идентификаторов ботов, ни текстов ошибок.
    const rows = await pageAll(
      (from, to) =>
        serviceDb()
          .from("bot_health_snapshots")
          .select("ok")
          .gte("at", since)
          .order("at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      "bot_health_snapshots",
    );
    const { data, error } = await serviceDb()
      .from("bot_health_snapshots")
      .select("at")
      .eq("ok", false)
      .order("at", { ascending: false })
      .limit(1);
    if (error) return { state: "unknown", readFailed: true };
    return {
      state: telegramState(rows.length, rows.filter((r) => !r.ok).length),
      lastFailAt: data?.[0]?.at ?? null,
    };
  } catch {
    return { state: "unknown", readFailed: true };
  }
}

/** Вебхук Zernio — общий для Instagram и WhatsApp; из состояния читаем только его ключ. */
export async function zernioSignal(): Promise<Signal> {
  try {
    const { data, error } = await serviceDb()
      .from("operator_settings")
      .select("value")
      .eq("key", "operator_platform_alerts")
      .maybeSingle();
    if (error) return { state: "unknown", readFailed: true };
    if (!data?.value) return { state: "unknown" };
    const s = parseAlertStates(data.value)["zernio:webhook"];
    if (!s) return { state: "unknown" };
    return s.fails >= THRESHOLD
      ? { state: "degraded", lastFailAt: s.since }
      : { state: "ok", lastFailAt: null };
  } catch {
    return { state: "unknown", readFailed: true };
  }
}

async function databaseSignal(now: Date): Promise<Signal> {
  try {
    await tenantDirectory();
    return { state: "ok" };
  } catch {
    return { state: "degraded", lastFailAt: now.toISOString() };
  }
}

export async function platformStatus(now = new Date()) {
  const [telegram, zernio, database, crons] = await Promise.all([
    telegramSignal(now),
    zernioSignal(),
    databaseSignal(now),
    listCronStatus(now).catch(() => null),
  ]);
  const services = serviceStatuses(crons, {
    telegram_bots: telegram,
    zernio_webhook: zernio,
    database,
  });
  return { at: now.toISOString(), overall: overallState(services), services };
}
