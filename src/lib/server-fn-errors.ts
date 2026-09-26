import { reportError, type ErrorContext } from "./errors";

/**
 * Ошибки серверных функций админки и панели оператора — в учёт ошибок.
 * Серверная функция бросает и сбои (база, Zernio, опечатка в коде), и
 * обычные отказы человеку («неверный пароль», «заказ уже закрыт»). Вторые —
 * не ошибки платформы, в Sentry их не шлём:
 *   • UserError ядра и ошибка разбора ввода (ZodError);
 *   • нет сессии (Unauthorized), redirect/notFound маршрутизатора;
 *   • обычный Error с русским текстом — так панели пишут отказы человеку.
 * Всё остальное (TypeError, «Zernio API 500», «duplicate key…») — сбой.
 */
export function isPlatformFailure(e: unknown): boolean {
  if (e === null || typeof e !== "object") return true;
  if (e instanceof Response) return false;
  const x = e as { name?: unknown; message?: unknown; isRedirect?: unknown; isNotFound?: unknown };
  if (x.isRedirect || x.isNotFound) return false;
  if (x.name === "UserError" || x.name === "ZodError") return false;
  const message = typeof x.message === "string" ? x.message : "";
  if (message === "Unauthorized") return false;
  if (e instanceof Error && e.constructor === Error && /[А-Яа-яЁё]/.test(message)) return false;
  return true;
}

/** Панель по файлу серверной функции: src/app/admin/… или src/app/operator/…. */
export function panelOf(filename: string | undefined): "admin" | "operator" | "app" {
  if (filename?.includes("/app/admin/")) return "admin";
  if (filename?.includes("/app/operator/")) return "operator";
  return "app";
}

type Call<R> = {
  next: () => Promise<R>;
  serverFnMeta?: { name?: string; filename?: string };
};

type Deps = {
  /** Клиент, если это админка и сессия продавца действует. */
  botId?: () => Promise<string | null>;
  report?: (e: unknown, c: ErrorContext) => Promise<void>;
};

/** Тело прослойки (src/start.ts): сбой — в учёт, ошибка идёт дальше как была. */
export async function reportServerFnFailure<R>(call: Call<R>, deps: Deps = {}): Promise<R> {
  try {
    return await call.next();
  } catch (e) {
    if (isPlatformFailure(e)) {
      try {
        const panel = panelOf(call.serverFnMeta?.filename);
        const botId = panel === "admin" && deps.botId ? await deps.botId() : null;
        await (deps.report ?? reportError)(e, {
          where: `serverFn:${panel}`,
          botId,
          extra: { fn: call.serverFnMeta?.name ?? "unknown" },
        });
      } catch {
        // Учёт ошибок не должен подменять исходную ошибку.
      }
    }
    throw e;
  }
}
