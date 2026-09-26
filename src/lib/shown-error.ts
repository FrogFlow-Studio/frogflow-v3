import { errorMessage } from "./error-message";

/**
 * Что человек видит на экране при ошибке. Показываем только текст, который
 * для него написан: отказ ядра (UserError, уже переведённый), русский отказ
 * панели, проверку формы. Сервер помечает такие ошибки именем ShownError
 * (src/start.ts); имя переживает передачу из серверной функции в браузер.
 *
 * Всё остальное — сбой: TypeError в коде страницы («Cannot read properties
 * of undefined»), обрыв сети, HTML-страница 500 от Vercel вместо ответа.
 * Вместо сырого текста — понятная фраза на языке панели, подробности уходят
 * в Sentry (серверные сбои — из src/start.ts, браузерные —
 * /api/client-error).
 */
import type { Locale } from "@/core/i18n/locale";

export const SHOWN_ERROR = "ShownError";

/** Ошибка, текст которой можно показать человеку как есть. */
export function shownError(message: string): Error {
  const e = new Error(message);
  e.name = SHOWN_ERROR;
  return e;
}

export function isShownError(e: unknown): e is Error {
  return e instanceof Error && e.name === SHOWN_ERROR && e.message.trim() !== "";
}

export type ScreenErrorKind = "shown" | "session" | "aborted" | "failure";

export function screenErrorKind(e: unknown): ScreenErrorKind {
  if (isShownError(e)) return "shown";
  if (e instanceof Error && e.message === "Unauthorized") return "session";
  if (e instanceof Error && e.name === "AbortError") return "aborted";
  return "failure";
}

const FALLBACK: Record<Locale, { failure: string; session: string; retry: string }> = {
  ru: {
    failure: "Не удалось связаться с сервером. Попробуйте ещё раз.",
    session: "Сессия закончилась. Обновите страницу и войдите заново.",
    retry: "Обновить страницу",
  },
  kk: {
    failure: "Сервермен байланысу мүмкін болмады. Қайта көріңіз.",
    session: "Сессия аяқталды. Бетті жаңартып, қайта кіріңіз.",
    retry: "Бетті жаңарту",
  },
  en: {
    failure: "Could not reach the server. Please try again.",
    session: "Your session has ended. Refresh the page and sign in again.",
    retry: "Refresh the page",
  },
  uz: {
    failure: "Server bilan bogʻlanib boʻlmadi. Qayta urinib koʻring.",
    session: "Sessiya tugadi. Sahifani yangilab, qayta kiring.",
    retry: "Sahifani yangilash",
  },
};

function asLocale(lang: string | undefined | null): Locale {
  const l = (lang ?? "").slice(0, 2).toLowerCase();
  return l === "kk" || l === "en" || l === "uz" ? l : "ru";
}

/** Текст ошибки для экрана; `lang` — язык панели (атрибут lang у <html>). */
export function screenErrorText(e: unknown, lang?: string | null): string {
  const kind = screenErrorKind(e);
  if (kind === "shown") return (e as Error).message;
  const t = FALLBACK[asLocale(lang)];
  return kind === "session" ? t.session : t.failure;
}

/** Подпись кнопки «обновить страницу» на языке панели. */
export function retryText(lang?: string | null): string {
  return FALLBACK[asLocale(lang)].retry;
}

/** Сбой, о котором браузер сообщает серверу: не отказ, не сессия, не отмена. */
export function isBrowserFailure(e: unknown): boolean {
  return screenErrorKind(e) === "failure";
}

export type ClientErrorReport = { name: string; message: string; stack?: string; path: string };

const cut = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/** Короткий отчёт о браузерном сбое: без данных формы, с обрезанными полями. */
export function clientErrorReport(e: unknown, path: string): ClientErrorReport {
  const err = e instanceof Error ? e : null;
  return {
    name: cut(err?.name ?? typeof e, 80) || "Error",
    message: cut(errorMessage(e), 500),
    stack: cut(err?.stack, 4000) || undefined,
    path: cut(path, 200),
  };
}
