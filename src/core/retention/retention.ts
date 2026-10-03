import { serviceDb } from "@/core/db/client.server";
import { servedByV2 } from "@/core/tenant/directory";
import { LEAD_PREFIX, isClosedStage, parseLead } from "@/core/pipeline/stages";
import { RECEIPT_CHECKS_PREFIX, receiptChecksDay } from "@/core/receipts/attempts";
import { RATE_LIMIT_PREFIX, parseCounter } from "@/core/storefront/rate-limit";
import { CHECKOUT_CHALLENGE_PREFIX } from "@/core/storefront/checkout-guard";
import { chunksOf, IN_CHUNK } from "@/lib/in-chunks";

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
  /** Закрытые заявки воронки (выполнено, потеряно) — после закрытия. */
  closedLeadsDays: 90,
  /**
   * Счётчики автопроверок чека покупателя (core/receipts/attempts). Дневной
   * лимит живёт сутки, лимит заказа — пока жив заказ: неделя, как у v1 для
   * неоплаченных заказов без чека.
   */
  receiptChecksDays: 7,
  /** Общие счётчики лимита частоты: окна у них минутные, сутки — с запасом. */
  rateLimitDays: 1,
  /** Брони решённых задач оформления на витрине: задача живёт 2 часа. */
  checkoutChallengesDays: 1,
} as const;

export const BATCH = 2000;
/**
 * Список id уходит в строку запроса PostgREST: две тысячи UUID — это ~75 КБ
 * и «Request Header Fields Too Large» (так упал первый прогон на живой
 * таблице). Удаляем порциями по 150 — около 6 КБ на запрос.
 */
const DELETE_CHUNK = 150;

export type PruneResult = { deleted: number; done: boolean };

/**
 * Границы прохода: только клиенты v2 (`servedByV2`) — журналы клиентов
 * прежней платформы чистит она сама. `undefined` — без границ (тесты);
 * пустой список — чистить нечего.
 */
export type Scope = readonly string[] | undefined;
const none: PruneResult = { deleted: 0, done: true };

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

async function pruneByAt(
  table: ByAt,
  days: number,
  now: number,
  scope: Scope,
): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  let q = serviceDb().from(table).select("id").lt("at", cutoff(days, now));
  if (scope) q = q.in("bot_id", [...scope]);
  const { data, error } = await q.order("at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`${table}: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id);
  await deleteIds(table, ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

export async function pruneZernioLogs(now = Date.now(), scope?: Scope): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  const db = serviceDb();
  let q1 = db
    .from("zernio_logs")
    .select("id")
    .in("status", ["processed", "ignored"])
    .lt("created_at", cutoff(RETENTION.zernioLogsDays, now));
  if (scope) q1 = q1.in("bot_id", [...scope]);
  const { data: settled, error } = await q1.order("created_at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`zernio_logs: ${error.message}`);
  const ids = (settled ?? []).map((r) => r.id);
  if (ids.length < BATCH) {
    let q2 = db
      .from("zernio_logs")
      .select("id")
      .not("status", "in", "(processed,ignored)")
      // Обращения helpdesk (core/helpdesk: event_type = ticket, свои статусы
      // open/waiting/closed) — не журнал вебхука, а учёт продавца: их чистка
      // не трогает. По event_type, а не по event_id: у старых строк вебхука
      // event_id бывает null, а NOT LIKE на null отбросил бы и их.
      .neq("event_type", "ticket")
      // Возврат по заказу (core/orders/refund) — учёт денег: без него
      // частичный возврат через полгода снова попал бы в выручку.
      .neq("event_type", "order.refund")
      .lt("created_at", cutoff(RETENTION.zernioLogsStaleDays, now));
    if (scope) q2 = q2.in("bot_id", [...scope]);
    const { data: stale, error: e2 } = await q2
      .order("created_at", { ascending: true })
      .limit(BATCH - ids.length);
    if (e2) throw new Error(`zernio_logs: ${e2.message}`);
    ids.push(...(stale ?? []).map((r) => r.id));
  }
  await deleteIds("zernio_logs", ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

export async function pruneManagerChatMessages(
  now = Date.now(),
  scope?: Scope,
): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  let q = serviceDb()
    .from("manager_chat_messages")
    .select("id")
    .lt("created_at", cutoff(RETENTION.managerChatDays, now));
  if (scope) q = q.in("bot_id", [...scope]);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`manager_chat_messages: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id);
  await deleteIds("manager_chat_messages", ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

export const pruneAdminLoginAttempts = (now = Date.now(), scope?: Scope) =>
  pruneByAt("admin_login_attempts", RETENTION.adminLoginsDays, now, scope);
/** Попытки входа оператора — платформенные, без bot_id: границы клиентов к ним не относятся. */
export const pruneOperatorLoginAttempts = (now = Date.now()) =>
  pruneByAt("operator_login_attempts", RETENTION.operatorLoginsDays, now, undefined);
export const pruneBotEvents = (now = Date.now(), scope?: Scope) =>
  pruneByAt("bot_events", RETENTION.botEventsDays, now, scope);
export const pruneHealthSnapshots = (now = Date.now(), scope?: Scope) =>
  pruneByAt("bot_health_snapshots", RETENTION.healthSnapshotsDays, now, scope);

/**
 * Брони решённых задач регистрации (app/signup: `claimChallenge`) — строки
 * `operator_settings` с ключом `signup_challenge:<отпечаток>`, значение —
 * срок брони (выдача + сутки). Таблица общая с v1, поэтому удаляем строго по
 * префиксу: в LIKE «_» — любой символ, так что выборку ещё раз сверяем
 * `startsWith` и удаляем только точные ключи. Значение не дата — не трогаем.
 */
export const SIGNUP_CHALLENGE_PREFIX = "signup_challenge:";

export async function pruneSignupChallenges(now = Date.now()): Promise<PruneResult> {
  const db = serviceDb();
  const { data, error } = await db
    .from("operator_settings")
    .select("key, value")
    .like("key", `${SIGNUP_CHALLENGE_PREFIX}%`)
    .lt("value", new Date(now).toISOString())
    .limit(BATCH);
  if (error) throw new Error(`operator_settings: ${error.message}`);
  const rows = data ?? [];
  const keys = rows
    .filter((r) => r.key.startsWith(SIGNUP_CHALLENGE_PREFIX))
    .filter((r) => {
      const until = Date.parse(r.value ?? "");
      return Number.isFinite(until) && until < now;
    })
    .map((r) => r.key);
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const { error: e2 } = await db
      .from("operator_settings")
      .delete()
      .in("key", keys.slice(i, i + DELETE_CHUNK));
    if (e2) throw new Error(`operator_settings: ${e2.message}`);
  }
  // Полная порция, из которой ничего не удалено (все строки отсеяны сверкой),
  // — тоже конец: следующий круг вернул бы те же строки, и уборка крутилась бы
  // до конца бюджета времени.
  return { deleted: keys.length, done: rows.length < BATCH || keys.length === 0 };
}

/**
 * Счётчики автопроверок чека — строки app_settings `receipt_checks:<покупатель>`
 * по одной на покупателя, приславшего чек. Таблица общая с настройками
 * магазина (и с v1), поэтому, как у броней регистрации, удаляем строго по
 * префиксу: LIKE сверяется ещё раз `startsWith`, а удаляется только строка,
 * значение которой — счётчик с днём старше окна. Только клиенты v2.
 */
export async function pruneReceiptChecks(now = Date.now(), scope?: Scope): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  const db = serviceDb();
  let q = db
    .from("app_settings")
    .select("bot_id, key, value")
    .like("key", `${RECEIPT_CHECKS_PREFIX}%`)
    // Дата записи счётчика (updateSettingAtomic ставит её сама): свежие строки
    // в выборку не попадают и не заслоняют старые, сколько бы их ни было.
    .lt("updated_at", cutoff(RETENTION.receiptChecksDays, now));
  if (scope) q = q.in("bot_id", [...scope]);
  const { data, error } = await q.order("updated_at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`app_settings: ${error.message}`);
  const rows = data ?? [];
  const lastDay = cutoff(RETENTION.receiptChecksDays, now).slice(0, 10);
  const byBot = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.bot_id || !r.key.startsWith(RECEIPT_CHECKS_PREFIX)) continue;
    const day = receiptChecksDay(r.value);
    if (!day || day >= lastDay) continue;
    byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r.key]);
  }
  let deleted = 0;
  for (const [botId, keys] of byBot)
    for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
      const { error: e2 } = await db
        .from("app_settings")
        .delete()
        .eq("bot_id", botId)
        .in("key", keys.slice(i, i + DELETE_CHUNK));
      if (e2) throw new Error(`app_settings: ${e2.message}`);
      deleted += Math.min(DELETE_CHUNK, keys.length - i);
    }
  // Полная порция свежих счётчиков — дальше не продвинемся, остаток в следующий раз.
  return { deleted, done: rows.length < BATCH || deleted === 0 };
}

/**
 * Общие счётчики лимита частоты — строки app_settings `rate_limit:<вид>:<кто>`
 * (core/storefront/rate-limit). Как у счётчиков чеков: LIKE сверяется ещё раз
 * `startsWith`, удаляется только строка, значение которой — счётчик с окном
 * старше суток. Только клиенты v2.
 */
export async function pruneRateLimits(now = Date.now(), scope?: Scope): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  const db = serviceDb();
  const edge = cutoff(RETENTION.rateLimitDays, now);
  let q = db
    .from("app_settings")
    .select("bot_id, key, value")
    .like("key", `${RATE_LIMIT_PREFIX}%`)
    .lt("updated_at", edge);
  if (scope) q = q.in("bot_id", [...scope]);
  const { data, error } = await q.order("updated_at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`app_settings: ${error.message}`);
  const rows = data ?? [];
  const edgeMs = Date.parse(edge);
  const byBot = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.bot_id || !r.key.startsWith(RATE_LIMIT_PREFIX)) continue;
    const c = parseCounter(r.value);
    if (!c || c.w >= edgeMs) continue;
    byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r.key]);
  }
  let deleted = 0;
  for (const [botId, keys] of byBot)
    for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
      const { error: e2 } = await db
        .from("app_settings")
        .delete()
        .eq("bot_id", botId)
        .in("key", keys.slice(i, i + DELETE_CHUNK));
      if (e2) throw new Error(`app_settings: ${e2.message}`);
      deleted += Math.min(DELETE_CHUNK, keys.length - i);
    }
  return { deleted, done: rows.length < BATCH || deleted === 0 };
}

/**
 * Закрытые заявки воронки сделок — строки app_settings `crm:lead:<id>`.
 * Удаляем строго по префиксу (LIKE ещё раз сверяется startsWith) и только
 * заявку, закрытую раньше окна; открытые не трогаем, сколько бы им ни было.
 * Дата записи строки не позже даты закрытия, поэтому фильтр по updated_at
 * в запросе не пропускает ни одной подходящей строки. Только клиенты v2.
 */
export async function pruneClosedLeads(now = Date.now(), scope?: Scope): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  const db = serviceDb();
  const edge = cutoff(RETENTION.closedLeadsDays, now);
  let q = db
    .from("app_settings")
    .select("bot_id, key, value")
    .like("key", `${LEAD_PREFIX}%`)
    .lt("updated_at", edge);
  if (scope) q = q.in("bot_id", [...scope]);
  const { data, error } = await q.order("updated_at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`app_settings: ${error.message}`);
  const rows = data ?? [];
  const byBot = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.bot_id || !r.key.startsWith(LEAD_PREFIX)) continue;
    const lead = parseLead(r.value);
    if (!lead || !isClosedStage(lead.stage) || !lead.closed_at || lead.closed_at >= edge) continue;
    byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r.key]);
  }
  let deleted = 0;
  for (const [botId, keys] of byBot)
    for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
      const { error: e2 } = await db
        .from("app_settings")
        .delete()
        .eq("bot_id", botId)
        .in("key", keys.slice(i, i + DELETE_CHUNK));
      if (e2) throw new Error(`app_settings: ${e2.message}`);
      deleted += Math.min(DELETE_CHUNK, keys.length - i);
    }
  return { deleted, done: rows.length < BATCH || deleted === 0 };
}

export async function pruneBroadcastRecipients(
  now = Date.now(),
  scope?: Scope,
): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  const db = serviceDb();
  let q = db
    .from("broadcasts")
    .select("id")
    .lt("created_at", cutoff(RETENTION.broadcastRecipientsDays, now));
  if (scope) q = q.in("bot_id", [...scope]);
  const { data: old, error } = await q.limit(BATCH);
  if (error) throw new Error(`broadcasts: ${error.message}`);
  if (!old?.length) return { deleted: 0, done: true };
  // Рассылки идут в адрес запроса кусками: 2000 uuid разом — это 431.
  const ids: string[] = [];
  const oldIds = old.map((b) => b.id);
  for (let i = 0; i < oldIds.length && ids.length < BATCH; i += IN_CHUNK) {
    const { data, error: e2 } = await db
      .from("broadcast_recipients")
      .select("id")
      .in("broadcast_id", oldIds.slice(i, i + IN_CHUNK))
      .limit(BATCH - ids.length);
    if (e2) throw new Error(`broadcast_recipients: ${e2.message}`);
    ids.push(...(data ?? []).map((r) => r.id));
  }
  await deleteIds("broadcast_recipients", ids);
  return { deleted: ids.length, done: ids.length < BATCH };
}

/**
 * Брони задач оформления на витрине — строки app_settings
 * `checkout_challenge:<отпечаток>`. Строго по префиксу (LIKE сверяется ещё
 * раз startsWith), только старше суток и только клиенты v2.
 */
export async function pruneCheckoutChallenges(
  now = Date.now(),
  scope?: Scope,
): Promise<PruneResult> {
  if (scope && scope.length === 0) return none;
  const db = serviceDb();
  let q = db
    .from("app_settings")
    .select("bot_id, key")
    .like("key", `${CHECKOUT_CHALLENGE_PREFIX}%`)
    .lt("updated_at", cutoff(RETENTION.checkoutChallengesDays, now));
  if (scope) q = q.in("bot_id", [...scope]);
  const { data, error } = await q.order("updated_at", { ascending: true }).limit(BATCH);
  if (error) throw new Error(`app_settings: ${error.message}`);
  const rows = data ?? [];
  const byBot = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.bot_id || !r.key.startsWith(CHECKOUT_CHALLENGE_PREFIX)) continue;
    byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r.key]);
  }
  let deleted = 0;
  for (const [botId, keys] of byBot)
    for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
      const { error: e2 } = await db
        .from("app_settings")
        .delete()
        .eq("bot_id", botId)
        .in("key", keys.slice(i, i + DELETE_CHUNK));
      if (e2) throw new Error(`app_settings: ${e2.message}`);
      deleted += Math.min(DELETE_CHUNK, keys.length - i);
    }
  return { deleted, done: rows.length < BATCH || deleted === 0 };
}

/**
 * Весь проход; сбой одной таблицы не останавливает остальные. Каждая
 * таблица чистится порциями, пока не кончится хвост или бюджет времени:
 * накопленное за месяцы v1 иначе вытекало бы по 2000 строк в сутки.
 */
export async function runRetention(
  now = Date.now(),
  budgetMs = 40_000,
  /** Клиенты, чьи журналы чистим; по умолчанию — все на v2, включая архивных. */
  scope?: Scope,
): Promise<Record<string, PruneResult | { error: string }>> {
  if (!scope) {
    const { tenantDirectory } = await import("@/core/tenant/resolve.server");
    scope = (await tenantDirectory(true)).filter(servedByV2).map((t) => t.id);
  }
  // Список клиентов идёт в `.in("bot_id", …)`: чистим по IN_CHUNK клиентов за раз.
  const all: readonly string[] = scope ?? [];
  const parts: Scope[] = all.length > IN_CHUNK ? chunksOf(all, IN_CHUNK) : [all];
  const jobs: Record<string, (n: number, s: Scope) => Promise<PruneResult>> = {
    zernio_logs: (n, s) => pruneZernioLogs(n, s),
    manager_chat_messages: (n, s) => pruneManagerChatMessages(n, s),
    admin_login_attempts: (n, s) => pruneAdminLoginAttempts(n, s),
    operator_login_attempts: (n) => pruneOperatorLoginAttempts(n),
    bot_events: (n, s) => pruneBotEvents(n, s),
    bot_health_snapshots: (n, s) => pruneHealthSnapshots(n, s),
    broadcast_recipients: (n, s) => pruneBroadcastRecipients(n, s),
    // Платформенные брони регистрации, без bot_id: границы клиентов к ним не относятся.
    signup_challenges: (n) => pruneSignupChallenges(n),
    closed_leads: (n, s) => pruneClosedLeads(n, s),
    receipt_checks: (n, s) => pruneReceiptChecks(n, s),
    rate_limits: (n, s) => pruneRateLimits(n, s),
    checkout_challenges: (n, s) => pruneCheckoutChallenges(n, s),
    // Копии PDF со знаком (core/delivery) — только клиенты v2 и только `<клиент>/wm/`.
    watermark_copies: async (n, s) =>
      (await import("@/core/delivery/watermark.server")).pruneStampedCopies(s ?? [], n),
  };
  // Без границ клиентов — один проход на всех, а не по куску.
  const platformWide = new Set(["operator_login_attempts", "signup_challenges"]);
  const out: Record<string, PruneResult | { error: string }> = {};
  const startedAt = Date.now();
  for (const [name, job] of Object.entries(jobs)) {
    try {
      let deleted = 0;
      let allDone = true;
      for (const part of platformWide.has(name) ? [all] : parts) {
        let done = false;
        while (!done && Date.now() - startedAt < budgetMs) {
          const r = await job(now, part);
          deleted += r.deleted;
          done = r.done;
        }
        if (!done) allDone = false;
      }
      out[name] = { deleted, done: allDone };
    } catch (e) {
      out[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}
