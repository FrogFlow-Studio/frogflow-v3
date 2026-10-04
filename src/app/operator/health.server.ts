import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { telegramApi } from "@/channels/telegram/api";
import { telegramWebhookUrl } from "@/channels/telegram/secret";
import { tenantContext, tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Снимки здоровья ботов — источник «Истории падений» в панели оператора.
 * Раз в 15 минут крон спрашивает у Telegram getWebhookInfo каждого бота на
 * v2: вебхук на нашем адресе, очередь обновлений, последняя ошибка
 * доставки. Бот «здоров», если вебхук стоит куда надо и Telegram не
 * жаловался последние 15 минут. Клиенты без токена не пишутся — это не
 * падение, а недоделанная настройка.
 */
export type HealthSnapshot = {
  bot_id: string;
  ok: boolean;
  error: string | null;
  pending_updates: number | null;
};

const RECENT_ERROR_MS = 15 * 60_000;

export async function probeTenantHealth(
  t: Awaited<ReturnType<typeof tenantDirectory>>[number],
  now = Date.now(),
): Promise<HealthSnapshot | null> {
  if (!t.telegramTokenEnc) return null;
  const expected = telegramWebhookUrl(env().APP_URL, t.id);
  try {
    const api = telegramApi(tenantContext(t).secrets.telegramToken(), env().TELEGRAM_API_BASE);
    const info = await api.call<{
      url?: string;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
    }>("getWebhookInfo");
    if (!info.ok)
      return {
        bot_id: t.id,
        ok: false,
        error: info.description ?? "getWebhookInfo failed",
        pending_updates: null,
      };
    const r = info.result ?? {};
    const recentError =
      r.last_error_date && now - r.last_error_date * 1000 < RECENT_ERROR_MS
        ? (r.last_error_message ?? "ошибка доставки обновлений")
        : null;
    const wrongUrl = r.url !== expected;
    return {
      bot_id: t.id,
      ok: !wrongUrl && !recentError,
      error: wrongUrl ? `вебхук: ${r.url || "не установлен"}` : recentError,
      pending_updates: r.pending_update_count ?? 0,
    };
  } catch (e) {
    return {
      bot_id: t.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      pending_updates: null,
    };
  }
}

type HealthTenants = Awaited<ReturnType<typeof tenantDirectory>>;

/**
 * Без onlyBotId — прогон крона: снимки всех ботов v2 и уведомления
 * оператору о сбоях (health-alerts). Проверка одного бота из панели в счёт
 * «проверок подряд» не идёт.
 */
export async function recordHealthSnapshots(onlyBotId?: string): Promise<{
  inserted: number;
  failing: string[];
  alerts?: Awaited<ReturnType<typeof processHealthAlertsSafe>>;
}> {
  const tenants = (await tenantDirectory(true)).filter((t) =>
    onlyBotId ? t.id === onlyBotId : t.settings.served_by === "v2" && !t.archived,
  );
  const rows = await probeAndInsert(tenants);
  const summary = {
    inserted: rows.length,
    failing: rows.filter((r) => !r.ok).map((r) => r.bot_id),
  };
  if (onlyBotId) return summary;
  return { ...summary, alerts: await processHealthAlertsSafe(rows, tenants) };
}

/** Сбой уведомлений не ломает запись снимков: ошибка уходит в итог крона. */
async function processHealthAlertsSafe(rows: HealthSnapshot[], tenants: HealthTenants) {
  try {
    const { processHealthAlerts } = await import("./health-alerts.server");
    return await processHealthAlerts(rows, new Map(tenants.map((t) => [t.id, t.name])));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function recordHealthSnapshotsFor(
  tenants: HealthTenants,
): Promise<{ inserted: number; failing: string[] }> {
  const rows = await probeAndInsert(tenants);
  return { inserted: rows.length, failing: rows.filter((r) => !r.ok).map((r) => r.bot_id) };
}

async function probeAndInsert(tenants: HealthTenants): Promise<HealthSnapshot[]> {
  const rows = (await Promise.all(tenants.map((t) => probeTenantHealth(t)))).filter(
    (r): r is HealthSnapshot => r !== null,
  );
  if (rows.length) {
    const { error } = await serviceDb().from("bot_health_snapshots").insert(rows);
    if (error) throw serverFailure(`Не удалось записать снимки: ${error.message}`);
  }
  return rows;
}

export type LatestHealth = {
  ok: boolean;
  at: string;
  error: string | null;
  pending: number | null;
};

/** Сколько клиентов спрашиваем одновременно: запросы крошечные, но не всей пачкой разом. */
const LATEST_PARALLEL = 20;

/**
 * Последний снимок по каждому клиенту — для списка. Отдельный запрос на
 * клиента с limit(1): общий «последние N строк» терял клиентов, чей
 * последний снимок старше чужих N (бот без токена, v1, архив), а при
 * сотне ботов на v2 1500 строк — это меньше четырёх часов снимков.
 */
export async function latestHealth(ids?: string[]): Promise<Map<string, LatestHealth>> {
  const botIds = ids ?? (await tenantDirectory(true)).map((t) => t.id);
  const out = new Map<string, LatestHealth>();
  for (let i = 0; i < botIds.length; i += LATEST_PARALLEL)
    await Promise.all(
      botIds.slice(i, i + LATEST_PARALLEL).map(async (id) => {
        const { data, error } = await serviceDb()
          .from("bot_health_snapshots")
          .select("bot_id, ok, at, error, pending_updates")
          .eq("bot_id", id)
          .order("at", { ascending: false })
          .limit(1);
        if (error) throw serverFailure(`bot_health_snapshots: ${error.message}`);
        const r = data?.[0];
        if (r) out.set(id, { ok: r.ok, at: r.at, error: r.error, pending: r.pending_updates });
      }),
    );
  return out;
}

export type HealthOutage = { startedAt: string; endedAt: string | null; error: string | null };
export type HealthHistory = {
  uptimeRatio: number | null;
  snapshotCount: number;
  outages: HealthOutage[];
};

/** Снимки за период схлопываются в интервалы простоя: оператору интересно «когда и сколько». */
export async function getHealthHistory(botId: string, days = 14): Promise<HealthHistory> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  // Снимок раз в 15 минут — 1344 строки за 14 дней, больше потолка PostgREST
  // в 1000: одним запросом терялись последние дни. Читаем постранично.
  const rows = await pageAll(
    (from, to) =>
      serviceDb()
        .from("bot_health_snapshots")
        .select("at, ok, error")
        .eq("bot_id", botId)
        .gte("at", cutoff)
        // Второй ключ сортировки — чтобы страницы не перекрывались при равных at.
        .order("at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "bot_health_snapshots",
  );
  if (rows.length === 0) return { uptimeRatio: null, snapshotCount: 0, outages: [] };
  const outages: HealthOutage[] = [];
  let open: { startedAt: string; error: string | null } | null = null;
  for (const r of rows) {
    if (!r.ok && !open) open = { startedAt: r.at, error: r.error };
    else if (r.ok && open) {
      outages.push({ ...open, endedAt: r.at });
      open = null;
    }
  }
  if (open) outages.push({ ...open, endedAt: null });
  return {
    uptimeRatio: rows.filter((r) => r.ok).length / rows.length,
    snapshotCount: rows.length,
    outages: outages.reverse(),
  };
}
