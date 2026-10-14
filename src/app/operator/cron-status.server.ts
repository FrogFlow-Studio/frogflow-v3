import { serviceDb } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Состояние кронов для панели оператора: последний запуск, итог, длительность,
 * ошибка — по задаче, в `operator_settings` (KV платформы без bot_id, ключ
 * `cron:<job>`). Суточные задачи запускает Vercel Cron (vercel.json), частые —
 * cron-job.org по docs/external-crons.md; расписание здесь общее. Страница считает
 * задачу «молчит», если последний запуск старше двух интервалов.
 */
export const CRON_JOBS = [
  {
    job: "ensure-webhook",
    schedule: "0 * * * *",
    everyMin: 60,
    title: "Вебхуки Telegram и Zernio",
  },
  { job: "broadcast", schedule: "* * * * *", everyMin: 1, title: "Рассылки и outbox" },
  {
    job: "inbox-poll",
    schedule: "* * * * *",
    everyMin: 1,
    title: "Добор входящих Instagram/WhatsApp для консультанта",
  },
  { job: "cart-reminder", schedule: "*/30 * * * *", everyMin: 30, title: "Брошенные корзины" },
  {
    job: "fulfillment-reminder",
    schedule: "0 * * * *",
    everyMin: 60,
    title: "Напоминания о выдаче",
  },
  { job: "vip", schedule: "*/10 * * * *", everyMin: 10, title: "VIP-подписки" },
  {
    job: "course-lives",
    schedule: "*/10 * * * *",
    everyMin: 10,
    title: "Напоминания об эфирах школы",
  },
  {
    job: "health",
    schedule: "*/15 * * * *",
    everyMin: 15,
    title: "Здоровье, аккаунты Zernio, дайджесты",
  },
  {
    job: "comment-dm-fallback",
    schedule: "7,22,37,52 * * * *",
    everyMin: 15,
    title: "Резервные DM по комментариям",
  },
  {
    job: "subscriptions",
    schedule: "0 4 * * *",
    everyMin: 1440,
    title: "Подписки клиентов и каталоги из Google Таблиц",
  },
  {
    job: "giveaways",
    schedule: "*/5 * * * *",
    everyMin: 5,
    title: "Розыгрыши: итоги и сообщения победителям",
  },
  {
    job: "observer",
    schedule: "11,26,41,56 * * * *",
    everyMin: 15,
    title: "ИИ-наблюдатель за диалогами",
  },
  { job: "retention", schedule: "20 3 * * *", everyMin: 1440, title: "Ретеншн журналов" },
  { job: "leads", schedule: "0 6 * * *", everyMin: 1440, title: "Конвейер лидов оператора" },
] as const;

export type CronJob = (typeof CRON_JOBS)[number]["job"];

export type CronRun = {
  at: string;
  ok: boolean;
  durationMs: number;
  tenants: number;
  /** Короткая сводка результатов — первые строки JSON без вложенности. */
  summary: string;
  error: string | null;
  /** С кого (или с какого этапа) начать следующий запуск: бюджет времени вышел (lib/cron-budget). */
  resume?: string | null;
  /** Сколько клиентов отложено до следующего запуска (бюджет вышел). */
  skipped?: number;
  /** Сколько запусков подряд упёрлись в бюджет, включая этот; 0 — уложились. */
  budgetStreak?: number;
};

/** Серия упоров в бюджет: растёт, пока запуск оставляет `resume`, иначе обнуляется. */
export function nextBudgetStreak(prev: CronRun | null, run: Pick<CronRun, "resume">): number {
  if (!run.resume) return 0;
  return (prev?.budgetStreak ?? 0) + 1;
}

const key = (job: string) => `cron:${job}`;

export function summarizeResults(results: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(results).slice(0, 12)) {
    const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${s.length > 160 ? `${s.slice(0, 160)}…` : s}`);
  }
  return parts.join("\n").slice(0, 3000);
}

export async function recordCronRun(job: string, run: CronRun): Promise<void> {
  const db = serviceDb();
  const { data, error: readErr2 } = await db
    .from("operator_settings")
    .select("key, value")
    .eq("key", key(job))
    .maybeSingle();
  if (readErr2) throw serverFailure(`[cron] статус не прочитан: ${readErr2.message}`);
  let prev: CronRun | null = null;
  try {
    prev = data?.value ? (JSON.parse(data.value) as CronRun) : null;
  } catch {
    /* битая запись — как отсутствие */
  }
  const value = JSON.stringify({ ...run, budgetStreak: nextBudgetStreak(prev, run) });
  const r = data
    ? await db.from("operator_settings").update({ value }).eq("key", key(job))
    : await db.from("operator_settings").insert({ key: key(job), value });
  if (r.error) console.warn(`[cron] статус ${job} не записан: ${r.error.message}`);
}

/** Откуда продолжить: первый пропущенный по бюджету в прошлом запуске, иначе `null`. */
export async function readCronResume(job: string): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", key(job))
    .maybeSingle();
  if (error) throw serverFailure(`[cron] прошлый запуск не прочитан: ${error.message}`);
  try {
    const resume = data?.value ? (JSON.parse(data.value) as CronRun).resume : null;
    return typeof resume === "string" ? resume : null;
  } catch {
    return null;
  }
}

export type CronStatus = (typeof CRON_JOBS)[number] & {
  last: CronRun | null;
  stale: boolean;
};

/** Задача молчит, если последний запуск старше двух интервалов (или его не было). */
export function cronStale(everyMin: number, lastAt: string | null, now = new Date()): boolean {
  if (!lastAt) return true;
  return now.getTime() - Date.parse(lastAt) > 2 * everyMin * 60_000;
}

export async function listCronStatus(now = new Date()): Promise<CronStatus[]> {
  const { data, error: readErr } = await serviceDb()
    .from("operator_settings")
    .select("key, value")
    .like("key", "cron:%");
  if (readErr) throw serverFailure(`[cron] статусы не прочитаны: ${readErr.message}`);
  const map = new Map<string, CronRun>();
  for (const row of data ?? []) {
    try {
      if (row.value) map.set(row.key.slice(5), JSON.parse(row.value) as CronRun);
    } catch {
      /* битая запись — как отсутствие */
    }
  }
  return CRON_JOBS.map((j) => {
    const last = map.get(j.job) ?? null;
    return { ...j, last, stale: cronStale(j.everyMin, last?.at ?? null, now) };
  });
}
