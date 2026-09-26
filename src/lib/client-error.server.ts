import { reportError, type ErrorContext } from "./errors";
import type { ClientErrorReport } from "./shown-error";

/**
 * Приём отчёта о сбое из браузера (/api/client-error): страница показала
 * человеку понятную фразу, а подробности — сюда и дальше в Sentry.
 *
 * Адрес открыт без сессии: сбой бывает и на странице входа. Поэтому:
 * только со своего сайта (Origin совпадает с хостом), тело не больше 8 КБ,
 * поля обрезаны, и не больше 30 отчётов в минуту на экземпляр — чтобы
 * чужой скрипт не выел квоту Sentry. Повторы одного сбоя режет reportError.
 */
export const MAX_BODY = 8 * 1024;
export const MAX_PER_MINUTE = 30;

let windowStart = 0;
let inWindow = 0;

/** Только для тестов. */
export function resetClientErrorLimit(): void {
  windowStart = 0;
  inWindow = 0;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** Разбор тела; кривое — null. */
export function parseClientReport(raw: unknown): ClientErrorReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const message = str(r.message, 500);
  const path = str(r.path, 200);
  if (!message || !path.startsWith("/")) return null;
  return {
    name: str(r.name, 80) || "Error",
    message,
    stack: str(r.stack, 4000) || undefined,
    path,
  };
}

/** Панель по адресу страницы — метка в Sentry. */
export function pageArea(path: string): string {
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/operator")) return "operator";
  if (path.startsWith("/s/")) return "storefront";
  return "site";
}

type Deps = {
  report?: (e: unknown, c: ErrorContext) => Promise<void>;
  now?: () => number;
};

export async function handleClientError(request: Request, deps: Deps = {}): Promise<Response> {
  if (!sameOrigin(request)) return new Response("forbidden", { status: 403 });
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return new Response("too large", { status: 413 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // ниже — 400
  }
  const r = parseClientReport(raw);
  if (!r) return new Response("bad request", { status: 400 });

  const now = deps.now?.() ?? Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    inWindow = 0;
  }
  if (++inWindow > MAX_PER_MINUTE) return new Response(null, { status: 204 });

  const err = new Error(r.message);
  err.name = r.name;
  err.stack = r.stack ?? `${r.name}: ${r.message}`;
  await (deps.report ?? reportError)(err, {
    where: `browser:${pageArea(r.path)}`,
    extra: { path: r.path },
  });
  return new Response(null, { status: 204 });
}
