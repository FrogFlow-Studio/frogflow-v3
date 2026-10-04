import { randomUUID } from "node:crypto";
import { isUserError } from "@/core/i18n/user-error";
import { maskEmailsIn, scrubSecretsIn, truncate } from "./log-mask";

/**
 * Единая строка об ошибке функции (Л1): что отказало (`fn`), чей магазин
 * (`bot_id`), код, короткий номер запроса (`req`) и сообщение. Секретов в
 * строке нет: из сообщения вычёркиваются токены, подписи ссылок и почта;
 * стека, тела запроса и самих объектов ошибки нет — по ним в журнал уходили
 * ключи и данные покупателей. Полный разбор сбоя — в учёте ошибок (lib/errors).
 */
export type FailureFields = {
  fn: string;
  bot_id: string | null;
  code: string;
  req: string;
  msg: string;
};

const MSG_MAX = 200;
const CODE_OK = /^[\w.:-]{1,40}$/;

/** Короткий номер запроса: по нему строку находят в журнале и связывают с отчётом. */
export function requestId(): string {
  return randomUUID().slice(0, 8);
}

function codeOf(e: unknown): string {
  if (isUserError(e)) return e.key;
  const own = (e as { code?: unknown } | null)?.code;
  const raw = typeof own === "string" || typeof own === "number" ? String(own) : "";
  if (CODE_OK.test(raw)) return raw;
  const name = e instanceof Error ? e.name : "";
  return CODE_OK.test(name) ? name : "error";
}

export function failureFields(
  fn: string,
  e: unknown,
  opts: { botId?: string | null; code?: string; req?: string } = {},
): FailureFields {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return {
    fn,
    bot_id: opts.botId ?? null,
    code: opts.code && CODE_OK.test(opts.code) ? opts.code : codeOf(e),
    req: opts.req ?? requestId(),
    msg: truncate(maskEmailsIn(scrubSecretsIn(text)).replace(/\s+/g, " ").trim(), MSG_MAX),
  };
}

/** Записать ошибку единой строкой в журнал функции; возвращает номер запроса. */
export function logFailure(
  fn: string,
  e: unknown,
  opts: { botId?: string | null; code?: string; req?: string } = {},
): string {
  const f = failureFields(fn, e, opts);
  console.error(`[fail] ${JSON.stringify(f)}`);
  return f.req;
}
