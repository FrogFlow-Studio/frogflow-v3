/**
 * Отказ Zernio по полям ответа, а не по тексту. Документация (Error
 * Handling): `error` переписывается между релизами и ветвиться по нему
 * нельзя; стабильны статус, `type`, `code` и для отказа Meta —
 * `platformError.code`. Текст ошибки остаётся для журнала и продавца.
 */
export type ZernioFailure = {
  /** HTTP-статус; null — ответа не было (сеть, таймаут). */
  status: number | null;
  type?: string;
  code?: string;
  /** Код Meta из platformError (131047, 131026…). */
  platformCode?: number;
  /** error_subcode Meta (Instagram вне окна: код 10, подкод 2018278). */
  platformSubcode?: number;
  /** Retry-After в секундах (429, 503). */
  retryAfterSec?: number;
};

export class ZernioApiError extends Error {
  constructor(
    message: string,
    readonly failure: ZernioFailure,
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

/** Retry-After: секунды или HTTP-дата (RFC 9110); прошедшая дата — 0. */
export function parseRetryAfter(
  v: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const s = v?.trim();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  const at = Date.parse(s);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

export function parseZernioFailure(
  status: number,
  body: string,
  retryAfter?: string | null,
): ZernioFailure {
  const f: ZernioFailure = { status };
  const sec = parseRetryAfter(retryAfter);
  if (sec !== undefined) f.retryAfterSec = sec;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return f;
  }
  if (!json || typeof json !== "object") return f;
  const o = json as Record<string, unknown>;
  if (typeof o.type === "string") f.type = o.type;
  if (typeof o.code === "string") f.code = o.code;
  const pe = o.platformError;
  if (pe && typeof pe === "object") {
    const c = Number((pe as Record<string, unknown>).code);
    if (Number.isInteger(c)) f.platformCode = c;
    const sub = Number((pe as Record<string, unknown>).error_subcode);
    if (Number.isInteger(sub) && sub > 0) f.platformSubcode = sub;
  }
  // Часть ответов кладёт код Meta на верхний уровень: {"code": "131056"}
  // (WhatsApp, «If it fails»), иногда числом.
  if (f.platformCode === undefined && /^\d+$/.test(String(o.code ?? "")))
    f.platformCode = Number(o.code);
  return f;
}

/** Соединение не установлено — запрос до Zernio не дошёл, повтор безопасен. */
export const CONNECT_FAILED = "connect_failed";
const NOT_SENT_CAUSES = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"];

export function connectFailed(e: unknown): boolean {
  const cause = e instanceof Error ? (e.cause as { code?: string } | undefined) : undefined;
  return NOT_SENT_CAUSES.includes(cause?.code ?? "");
}

/** Структура отказа из пойманной ошибки; сеть и таймаут — status null. */
export function zernioFailureOf(e: unknown): ZernioFailure {
  return e instanceof ZernioApiError ? e.failure : { status: null };
}

/**
 * - window_closed — WhatsApp: 24 часа с последнего сообщения покупателя
 *   прошли (131047), писать можно только шаблоном; Instagram: то же окно
 *   (код 10, подкод 2018278), шаблонов нет;
 * - unreachable — получатель недостижим: нет WhatsApp или старое приложение
 *   (131026, 131021), номер не в списке теста (131030), аккаунт Meta
 *   заблокирован (131031), в диалоге нет получателя;
 * - permanent — повтор того же запроса ответ не изменит (ключ, права,
 *   аккаунт отключён или не найден, неверный запрос, отказ Meta 4xx с
 *   неизвестным кодом — ошибка вызывающего);
 * - rate_limited — лимит, пройдёт сам: на весь ключ (429, лимиты Meta) или
 *   на одного получателя (131056, см. rateLimitedRecipient);
 * - ambiguous — 500 или ответа нет (таймаут, сеть): Zernio мог уже
 *   отправить сообщение, слепой повтор может его удвоить (Send inbox
 *   message, 500; Idempotency) — сначала сверить переписку;
 * - temporary — 502/503 и прочее, после чего сообщение точно не ушло.
 */
export type ZernioFailureKind =
  "window_closed" | "unreachable" | "permanent" | "rate_limited" | "ambiguous" | "temporary";

const UNREACHABLE_META = [131021, 131026, 131030, 131031];
const IG_OUTSIDE_WINDOW = 2018278;
/** Лимиты и временные сбои Meta: 1/2 — «попробуйте позже», 4/17/32/613/80007/130429 — лимиты. */
const TEMPORARY_META = [1, 2];
const RATE_LIMIT_META = [4, 17, 32, 613, 80007, 130429, 131056];
const PERMANENT_CODES = [
  "DIRECT_SEND_NOT_ELIGIBLE",
  "DIRECT_SEND_BLOCKED",
  "PLATFORM_LIMITATION",
  "INVALID_TEMPLATE_HEADER",
  "TEMPLATE_REQUIRED",
  "ads_connection_required",
];

export function classifyZernioFailure(f: ZernioFailure | null | undefined): ZernioFailureKind {
  if (f?.status === null && f.code === CONNECT_FAILED) return "temporary";
  if (!f || f.status === null || f.status === 500) return "ambiguous";
  if (f.platformCode === 131047) return "window_closed";
  // Instagram: «This message is sent outside of allowed window» — код 10, подкод 2018278.
  if (f.platformCode === 10 && f.platformSubcode === IG_OUTSIDE_WINDOW) return "window_closed";
  if (f.code === "MISSING_PARTICIPANT" || UNREACHABLE_META.includes(f.platformCode ?? -1))
    return "unreachable";
  if (
    f.status === 429 ||
    f.code === "rate_limited" ||
    f.code === "DIRECT_SEND_LIMITED" ||
    RATE_LIMIT_META.includes(f.platformCode ?? -1)
  )
    return "rate_limited";
  if (TEMPORARY_META.includes(f.platformCode ?? -1)) return "temporary";
  if (f.code && PERMANENT_CODES.includes(f.code)) return "permanent";
  if ([400, 401, 402, 403, 404, 409, 422].includes(f.status)) return "permanent";
  return "temporary";
}

/** Лимит на одного получателя (131056): остальным покупателям писать можно. */
export const rateLimitedRecipient = (f: ZernioFailure | null | undefined) =>
  f?.platformCode === 131056;

/**
 * Отказ именно во вложении — по коду, не по тексту: платформа не принимает
 * такое вложение (400 PLATFORM_LIMITATION, «send inbox message») или
 * WhatsApp не смог скачать файл по ссылке (131052, «Media download failed»).
 * Звать только для отправки с вложением: PLATFORM_LIMITATION без вложения
 * значит другое (канал не умеет DM вовсе). Ошибка проверки полей запроса
 * («buttons[0].url is required» и т.п.) — не отказ вложения: без файла она
 * повторится. Принимает и структуру отказа, и пойманную ошибку.
 */
export function isAttachmentRejected(err: unknown): boolean {
  const f: ZernioFailure | null =
    err instanceof ZernioApiError
      ? err.failure
      : err && typeof err === "object" && "status" in err && !(err instanceof Error)
        ? (err as ZernioFailure)
        : null;
  if (!f) return false;
  return (f.status === 400 && f.code === "PLATFORM_LIMITATION") || f.platformCode === 131052;
}
