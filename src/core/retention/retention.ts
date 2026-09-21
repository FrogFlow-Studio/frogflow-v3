import { serviceDb } from "@/core/db/client.server";

/**
 * Ретеншн журналов — один проход на всех клиентов (serviceDb, правило 4).
 * В v1 `zernio_logs` без чистки занимал 72 % базы (62 МБ из 86, +1670
 * строк в сутки), `manager_chat_messages` — 14 725 строк за 5 дней у одного
 * клиента; остальные таблицы растут медленнее, но «никогда не удаляется»
 * кончается тем же, просто позже. Окна — как в v1; они не настраиваются
 * окружением намеренно: одна платформа, один режим.
 *
 * PostgREST не умеет LIMIT в DELETE: сначала выбираем порцию id, потом
 * удаляем по ним; `done: false` — остаток заберёт следующий запуск.
 * Крон serverless, «всё разом» на накопленном хвосте упёрся бы в таймаут.
 */
export const RETENTION = {
  /** Отработанные и пропущенные события вебхука. */
  zernioLogsDays: 30,
  /** Сбои и незавершённые — дольше: это единственный след, что событие не отработало. */
  zernioLogsStaleDays: 180,
  managerChatDays: 90,
  adminLoginsDays: 90,
  operatorLoginsDays: 90,
  /** История действий оператора — для разбора инцидентов, не техническая мелочь. */
  botEventsDays: 180,
  /** Получатели рассылок — по дате самой кампании: своей даты у строки нет. */
  broadcastRecipientsDays: 90,
  healthSnapshotsDays: 30,
} as const;

export const BATCH = 2000;
/**
 * Список id уходит в строку запроса PostgREST: две тысячи UUID — это ~75 КБ
 * и «Request Header Fields Too Large» (так упал первый прогон на живой
 * таблице). Удаляем порциями по 150 — около 6 КБ на запрос.
 */
const DELETE_CHUNK = 150;

export type PruneResult = { deleted: number; done: boolean };

const cutoff = (days: number, now: number) => new Date(now - days * 86_400_000).toISOString();

type ByAt =
  "admin_login_attempts" | "operator_login_attempts" | "bot_events" | "bot_health_snapshots";

async function deleteIds(table: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const { error } = await serviceDb()
      .from(table as "bot_events")
      .delete()
      .in("id", ids.slice(i, i + DELETE_CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function pruneByAt(table: ByAt, days: number, now: number): Promise<PruneResult> {
  const { data, error } = await serviceDb()
    .from(table)
    .select("id")
    .lt("at", cutoff(days, now))
    .order("at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`${table}: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id);
  await deleteIds(table, ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

export async function pruneZernioLogs(now = Date.now()): Promise<PruneResult> {
  const db = serviceDb();
  const { data: settled, error } = await db
    .from("zernio_logs")
    .select("id")
    .in("status", ["processed", "ignored"])
    .lt("created_at", cutoff(RETENTION.zernioLogsDays, now))
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`zernio_logs: ${error.message}`);
  const ids = (settled ?? []).map((r) => r.id);
  if (ids.length < BATCH) {
    const { data: stale, error: e2 } = await db
      .from("zernio_logs")
      .select("id")
      .not("status", "in", "(processed,ignored)")
      .lt("created_at", cutoff(RETENTION.zernioLogsStaleDays, now))
      .order("created_at", { ascending: true })
      .limit(BATCH - ids.length);
    if (e2) throw new Error(`zernio_logs: ${e2.message}`);
    ids.push(...(stale ?? []).map((r) => r.id));
  }
  await deleteIds("zernio_logs", ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

export async function pruneManagerChatMessages(now = Date.now()): Promise<PruneResult> {
  const { data, error } = await serviceDb()
    .from("manager_chat_messages")
    .select("id")
    .lt("created_at", cutoff(RETENTION.managerChatDays, now))
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`manager_chat_messages: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id);
  await deleteIds("manager_chat_messages", ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

export const pruneAdminLoginAttempts = (now = Date.now()) =>
  pruneByAt("admin_login_attempts", RETENTION.adminLoginsDays, now);
export const pruneOperatorLoginAttempts = (now = Date.now()) =>
  pruneByAt("operator_login_attempts", RETENTION.operatorLoginsDays, now);
export const pruneBotEvents = (now = Date.now()) =>
  pruneByAt("bot_events", RETENTION.botEventsDays, now);
export const pruneHealthSnapshots = (now = Date.now()) =>
  pruneByAt("bot_health_snapshots", RETENTION.healthSnapshotsDays, now);

export async function pruneBroadcastRecipients(now = Date.now()): Promise<PruneResult> {
  const db = serviceDb();
  const { data: old, error } = await db
    .from("broadcasts")
    .select("id")
    .lt("created_at", cutoff(RETENTION.broadcastRecipientsDays, now))
    .limit(BATCH);
  if (error) throw new Error(`broadcasts: ${error.message}`);
  if (!old?.length) return { deleted: 0, done: true };
  const { data, error: e2 } = await db
    .from("broadcast_recipients")
    .select("id")
    .in(
      "broadcast_id",
      old.map((b) => b.id),
    )
    .limit(BATCH);
  if (e2) throw new Error(`broadcast_recipients: ${e2.message}`);
  const ids = (data ?? []).map((r) => r.id);
  await deleteIds("broadcast_recipients", ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

/**
 * Весь проход; сбой одной таблицы не останавливает остальные. Каждая
 * таблица чистится порциями, пока не кончится хвост или бюджет времени:
 * накопленное за месяцы v1 иначе вытекало бы по 2000 строк в сутки.
 */
export async function runRetention(
  now = Date.now(),
  budgetMs = 40_000,
): Promise<Record<string, PruneResult | { error: string }>> {
  const jobs: Record<string, (n: number) => Promise<PruneResult>> = {
    zernio_logs: pruneZernioLogs,
    manager_chat_messages: pruneManagerChatMessages,
    admin_login_attempts: pruneAdminLoginAttempts,
    operator_login_attempts: pruneOperatorLoginAttempts,
    bot_events: pruneBotEvents,
    bot_health_snapshots: pruneHealthSnapshots,
    broadcast_recipients: pruneBroadcastRecipients,
  };
  const out: Record<string, PruneResult | { error: string }> = {};
  const startedAt = Date.now();
  for (const [name, job] of Object.entries(jobs)) {
    try {
      let deleted = 0;
      let done = false;
      while (!done && Date.now() - startedAt < budgetMs) {
        const r = await job(now);
        deleted += r.deleted;
        done = r.done;
      }
      out[name] = { deleted, done };
    } catch (e) {
      out[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}
