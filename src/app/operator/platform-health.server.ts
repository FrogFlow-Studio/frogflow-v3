import { serviceDb } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { serverFailure } from "@/lib/server-failure";
import { CRON_JOBS, listCronStatus } from "./cron-status.server";
import { latestHealth } from "./health.server";
import {
  TODO,
  cronRow,
  failuresLight,
  telegramLight,
  undeliveredLight,
  worstLight,
  type HealthRow,
  type Light,
} from "./platform-health";

const DAY_MS = 86_400_000;

export type PlatformHealth = {
  overall: Light;
  at: string;
  crons: HealthRow[];
  queues: HealthRow[];
};

async function count(
  label: string,
  q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const r = await q;
  // «Не удалось прочитать» не равно «ноль»: ноль нарисовал бы зелёный.
  if (r.error) throw serverFailure(`[здоровье] ${label}: ${r.error.message}`);
  return r.count ?? 0;
}

/** Все светофоры одной страницы. Крон-строк ровно по CRON_JOBS: новая задача без строки невозможна. */
export async function platformHealth(now = new Date()): Promise<PlatformHealth> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const logs = () => serviceDb().from("zernio_logs").select("id", { count: "exact", head: true });
  const [cronStatus, deadOutbox, queuedOutbox, failedEvents, tenants] = await Promise.all([
    listCronStatus(now),
    count("недоставленные", logs().like("event_type", "outbox.%").eq("status", "dead")),
    count("очередь", logs().like("event_type", "outbox.%").eq("status", "queued")),
    count(
      "сбои вебхуков",
      logs().not("event_type", "like", "outbox.%").eq("status", "failed").gte("created_at", since),
    ),
    tenantDirectory(true),
  ]);
  const v2 = tenants.filter((t) => servedByV2(t) && !t.archived && t.telegramTokenEnc);
  const latest = await latestHealth(v2.map((t) => t.id));
  const failingBots = v2.filter((t) => latest.get(t.id)?.ok === false).length;

  const crons = CRON_JOBS.map((j) => {
    const s = cronStatus.find((c) => c.job === j.job);
    return cronRow(j, s?.last ? { at: s.last.at, ok: s.last.ok, error: s.last.error } : null, now);
  });
  const deadLight = undeliveredLight(deadOutbox);
  const failLight = failuresLight(failedEvents);
  const tgLight = telegramLight(failingBots, v2.length);
  const queues: HealthRow[] = [
    {
      id: "undelivered",
      title: "Недоставленные сообщения (попытки кончились)",
      light: deadLight,
      detail: `${deadOutbox}; ждут повтора: ${queuedOutbox}`,
      todo: deadLight === "green" ? null : TODO.undelivered,
    },
    {
      id: "zernio-failed",
      title: "Сбои вебхуков Instagram/WhatsApp за сутки",
      light: failLight,
      detail: String(failedEvents),
      todo: failLight === "green" ? null : TODO.failed,
    },
    {
      id: "telegram",
      title: "Боты с жалобой Telegram на вебхук",
      light: tgLight,
      detail: `${failingBots} из ${v2.length}`,
      todo: tgLight === "green" ? null : TODO.telegram,
    },
  ];
  return {
    overall: worstLight([...crons, ...queues].map((r) => r.light)),
    at: now.toISOString(),
    crons,
    queues,
  };
}
