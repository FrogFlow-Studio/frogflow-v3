/**
 * «Здоровье платформы» оператора: чистая часть — светофор по крону, очереди и
 * отказам, и подсказка «что делать». Чтение базы — в platform-health.server.ts.
 */
export type Light = "green" | "yellow" | "red";

export type CronLightInput = {
  everyMin: number;
  /** Время последнего запуска; null — не запускался. */
  lastAt: string | null;
  /** Итог последнего запуска. */
  ok: boolean | null;
};

const RANK: Record<Light, number> = { green: 0, yellow: 1, red: 2 };

export function worstLight(lights: Light[]): Light {
  return lights.reduce<Light>((w, l) => (RANK[l] > RANK[w] ? l : w), "green");
}

/**
 * Крон: ошибка последнего запуска или тишина дольше трёх интервалов — красный;
 * тишина дольше своего интервала (или ни одного запуска) — жёлтый.
 */
export function cronLight(i: CronLightInput, now = new Date()): Light {
  if (!i.lastAt) return "yellow";
  if (i.ok === false) return "red";
  const age = now.getTime() - Date.parse(i.lastAt);
  if (!Number.isFinite(age)) return "yellow";
  if (age > 3 * i.everyMin * 60_000) return "red";
  if (age > i.everyMin * 60_000) return "yellow";
  return "green";
}

export const QUEUE_YELLOW = 1;
export const QUEUE_RED = 20;
export const FAILED_YELLOW = 1;
export const FAILED_RED = 50;

/** Очередь недоставленных: «не доставлено» (dead) — жёлтый с первого, красный от 20. */
export function undeliveredLight(dead: number): Light {
  if (dead >= QUEUE_RED) return "red";
  return dead >= QUEUE_YELLOW ? "yellow" : "green";
}

/** Сбои обработки вебхуков / отказы каналов за сутки. */
export function failuresLight(failed: number): Light {
  if (failed >= FAILED_RED) return "red";
  return failed >= FAILED_YELLOW ? "yellow" : "green";
}

/** Боты, у которых Telegram жалуется на вебхук: доля от всех на v2. */
export function telegramLight(failing: number, total: number): Light {
  if (failing === 0) return "green";
  return total > 0 && failing / total >= 0.3 ? "red" : "yellow";
}

export type HealthRow = {
  id: string;
  title: string;
  light: Light;
  /** Что видно: число, время. */
  detail: string;
  /** Что делать; пусто у зелёного. */
  todo: string | null;
};

export const TODO = {
  cronNever:
    "Крон ещё не отметился. Если задача новая — подождите один её интервал; иначе проверьте расписание в vercel.json и ответ /api/cron/<задача>.",
  cronFailed:
    "Последний запуск закончился ошибкой: откройте «Кроны», прочитайте ошибку и сводку; если ошибка про ключи — проверьте окружение в Vercel.",
  cronSilent:
    "Крон молчит дольше своего интервала: проверьте журнал запусков в Vercel (Cron Jobs) и CRON_SECRET; на Hobby расписание могло не сработать.",
  undelivered:
    "Есть сообщения, которые не дошли после всех повторов: причина — в строке ошибки у клиента («Не доставлено»); чаще всего покупатель заблокировал бота или токен канала протух.",
  failed:
    "Вебхуки Zernio падали при обработке: откройте «Настройки и вебхук Zernio» → «Проверить»; если ошибка одна и та же — перепривяжите вебхук.",
  telegram:
    "У этих ботов Telegram жалуется на вебхук: откройте клиента → «Здоровье», нажмите «Проверить»; ключ или адрес вебхука надо перепривязать.",
} as const;

export function cronRow(
  j: { job: string; title: string; everyMin: number },
  last: { at: string; ok: boolean; error: string | null } | null,
  now = new Date(),
): HealthRow {
  const light = cronLight(
    { everyMin: j.everyMin, lastAt: last?.at ?? null, ok: last?.ok ?? null },
    now,
  );
  const todo =
    light === "green"
      ? null
      : !last
        ? TODO.cronNever
        : last.ok === false
          ? TODO.cronFailed
          : TODO.cronSilent;
  return {
    id: `cron:${j.job}`,
    title: `${j.job} — ${j.title}`,
    light,
    detail: last
      ? `последний запуск ${last.at}${last.error ? `: ${last.error}` : ""}`
      : "не запускался",
    todo,
  };
}
