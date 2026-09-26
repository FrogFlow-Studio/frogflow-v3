/**
 * Учёт ошибок: исключение уходит в Sentry (или совместимый GlitchTip) с
 * клиентом, местом и версией деплоя. Без SDK — один POST конверта
 * (https://develop.sentry.dev/sdk/envelopes/): SDK на Nitro/Vercel тянет
 * инструментирование всего процесса, а нам нужен только отчёт о сбое, и он
 * должен успеть уйти до заморозки функции (waitUntil).
 *
 * Без SENTRY_DSN — только console.error, как было. Отчёт никогда не бросает
 * и не ломает обработку; одинаковые ошибки из одного экземпляра — не чаще
 * раза в минуту, чтобы сбой в цикле по покупателям не съел квоту.
 */
import { randomUUID } from "node:crypto";
import { env } from "@/config/env";

export type ErrorContext = {
  /** Где случилось: "telegram.update", "cron:broadcast", "zernio.dispatch"… */
  where: string;
  /** Арендатор, если известен. */
  botId?: string | null;
  /** Короткие несекретные подробности: id события, job, статус. */
  extra?: Record<string, string | number | boolean | null | undefined>;
};

export type ParsedDsn = { endpoint: string; publicKey: string };

/** https://<key>@<host>/<project> → адрес конверта и ключ; кривой DSN — null. */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !project) return null;
    const prefix = project.includes("/") ? project.slice(0, project.lastIndexOf("/") + 1) : "";
    const id = project.slice(prefix.length);
    return {
      endpoint: `${u.protocol}//${u.host}/${prefix}api/${id}/envelope/`,
      publicKey: decodeURIComponent(u.username),
    };
  } catch {
    return null;
  }
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number };

/** Стек V8 → кадры Sentry (старые сверху, как требует формат). */
export function parseStack(stack: string | undefined): Frame[] {
  const frames: Frame[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const m =
      /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) ?? /^\s*at (.+?) \((.+)\)$/.exec(line);
    if (!m) continue;
    frames.push({
      function: m[1] || "<anonymous>",
      filename: m[2],
      lineno: m[3] ? Number(m[3]) : undefined,
      colno: m[4] ? Number(m[4]) : undefined,
    });
  }
  return frames.reverse();
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : (JSON.stringify(e) ?? String(e)));
}

/** Событие Sentry из исключения и контекста. */
export function buildEvent(
  e: unknown,
  c: ErrorContext,
  meta: { environment?: string; release?: string; now?: Date } = {},
) {
  const err = asError(e);
  const frames = parseStack(err.stack);
  const extra = Object.fromEntries(
    Object.entries(c.extra ?? {}).filter(([, v]) => v !== undefined),
  );
  if (err.cause !== undefined) extra.cause = String(asError(err.cause).message);
  return {
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: (meta.now ?? new Date()).getTime() / 1000,
    platform: "node",
    level: "error",
    environment: meta.environment ?? "development",
    release: meta.release,
    tags: { where: c.where, ...(c.botId ? { bot_id: c.botId } : {}) },
    extra,
    exception: {
      values: [
        {
          type: err.name || "Error",
          value: err.message,
          ...(frames.length ? { stacktrace: { frames } } : {}),
        },
      ],
    },
  };
}

export function envelope(event: ReturnType<typeof buildEvent>, now = new Date()): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

const THROTTLE_MS = 60_000;
const lastSent = new Map<string, number>();

/** Только для тестов. */
export function resetErrorThrottle(): void {
  lastSent.clear();
}

type Deps = {
  dsn?: string | null;
  environment?: string;
  release?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

function defaultDeps(): Deps {
  try {
    const e = env();
    return { dsn: e.SENTRY_DSN, environment: e.VERCEL_ENV, release: e.VERCEL_GIT_COMMIT_SHA };
  } catch {
    return {};
  }
}

/**
 * Записать ошибку: в журнал всегда, в Sentry — если задан DSN. Возвращает
 * промис отправки (его можно не ждать: на Vercel он держится waitUntil).
 */
export async function reportError(e: unknown, c: ErrorContext, deps?: Deps): Promise<void> {
  console.error(`[${c.where}]${c.botId ? `[${c.botId}]` : ""}`, e);
  try {
    const d = deps ?? defaultDeps();
    const target = parseDsn(d.dsn);
    if (!target) return;
    const now = d.now?.() ?? Date.now();
    const err = asError(e);
    const key = `${c.where}|${c.botId ?? ""}|${err.name}|${err.message}`;
    if (now - (lastSent.get(key) ?? 0) < THROTTLE_MS) return;
    lastSent.set(key, now);
    if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value!);

    const event = buildEvent(err, c, {
      environment: d.environment,
      release: d.release,
      now: new Date(now),
    });
    const send = (d.fetch ?? fetch)(target.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=frogflow-v2/1`,
      },
      body: envelope(event, new Date(now)),
      signal: AbortSignal.timeout(3000),
    }).then(
      (res) => {
        if (!res.ok) console.warn(`[errors] Sentry ответил ${res.status} — отчёт не принят`);
      },
      (x: unknown) => console.warn("[errors] отчёт в Sentry не ушёл:", String(x)),
    );
    if (!deps) {
      try {
        const { waitUntil } = await import("@vercel/functions");
        waitUntil(send);
        return;
      } catch {
        // не Vercel — дождёмся сами
      }
    }
    await send;
  } catch (x) {
    console.warn("[errors] отчёт не собран:", String(x));
  }
}

export type TestErrorResult =
  { ok: true; eventId: string; status: number } | { ok: false; reason: string; status?: number };

/**
 * Проверка из панели оператора: пробная ошибка уходит в Sentry сразу (без
 * waitUntil и без ограничения частоты), чтобы увидеть ответ. Покупателей и
 * клиентов не касается.
 */
export async function sendTestError(deps?: Deps): Promise<TestErrorResult> {
  const d = deps ?? defaultDeps();
  if (!d.dsn) return { ok: false, reason: "SENTRY_DSN не задан в окружении деплоя." };
  const target = parseDsn(d.dsn);
  if (!target) return { ok: false, reason: "SENTRY_DSN задан, но не похож на DSN Sentry." };
  const now = new Date(d.now?.() ?? Date.now());
  const event = buildEvent(
    new Error("Проверка учёта ошибок из панели оператора"),
    { where: "operator.test" },
    { environment: d.environment, release: d.release, now },
  );
  event.level = "info";
  try {
    const res = await (d.fetch ?? fetch)(target.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=frogflow-v2/1`,
      },
      body: envelope(event, now),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok
      ? { ok: true, eventId: event.event_id, status: res.status }
      : { ok: false, status: res.status, reason: `Sentry ответил ${res.status}.` };
  } catch (x) {
    return { ok: false, reason: `Sentry недоступен: ${String(x)}` };
  }
}
