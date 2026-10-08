/**
 * Журнал попытки обновить курс рубля — строками для панели продавца на его
 * языке. Сервер пишет рядом две формы: `attempts` — русские строки, как и
 * раньше (их читают оператор и v1), и `entries` — коды с параметрами, которые
 * панель переводит на ru/kk/en/uz. Старый журнал без `entries` (или записанный
 * v1) панель показывает строками как есть.
 */
export type RateAttemptCode =
  | "ok"
  | "http"
  | "noRubRow"
  | "sourceStale"
  | "noRubInResponse"
  | "timeout"
  | "connection"
  | "error"
  | "outOfTime"
  | "jumpRejected";

export const RATE_ATTEMPT_CODES: readonly RateAttemptCode[] = [
  "ok",
  "http",
  "noRubRow",
  "sourceStale",
  "noRubInResponse",
  "timeout",
  "connection",
  "error",
  "outOfTime",
  "jumpRejected",
];

export type RateAttempt = {
  code: RateAttemptCode;
  /** Источник: адрес или «Kaspi (finkaz.kz)»; у общих строк его нет. */
  src?: string;
  /** Как стучались: через ретранслятор или без заголовка referer. */
  via?: "relay" | "noReferer";
  vars?: Record<string, string | number>;
};

/** Ошибка запроса → код попытки (таймаут, обрыв соединения, прочее с текстом). */
export function errorAttempt(err: unknown): Pick<RateAttempt, "code" | "vars"> {
  const raw = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out|aborted/i.test(raw)) return { code: "timeout" };
  if (/fetch failed|ECONNRESET|reset|EAI_AGAIN|ENOTFOUND|socket/i.test(raw))
    return { code: "connection", vars: { detail: raw } };
  return { code: "error", vars: { detail: raw } };
}

const v = (a: RateAttempt, k: string) => String(a.vars?.[k] ?? "");

/** Русская строка журнала — та же, что писалась до появления кодов. */
export function attemptText(a: RateAttempt): string {
  const src = a.src
    ? a.via === "relay"
      ? `ретранслятор ${a.src}`
      : a.via === "noReferer"
        ? `${a.src} (без referer)`
        : a.src
    : "";
  const body = (() => {
    switch (a.code) {
      case "ok":
        return `OK (покупка ${v(a, "buy")}${a.vars?.sell ? `, продажа ${v(a, "sell")}` : ""}${
          a.vars?.updated ? `, обновлено ${v(a, "updated")}` : ""
        })`;
      case "http":
        return `ответ ${v(a, "status")}`;
      case "noRubRow":
        return "страница открылась, но строки RUB / KZT в ней нет";
      case "sourceStale":
        return `курс на сайте от ${v(a, "at")}, старше суток`;
      case "noRubInResponse":
        return "ответ получен, но курса рубля в нём нет";
      case "timeout":
        return "не ответил за 6 секунд (таймаут)";
      case "connection":
        return `соединение не установлено (${v(a, "detail")})`;
      case "error":
        return v(a, "detail");
      case "outOfTime":
        return "дальше не пробовали: вышло время на обход источников";
      case "jumpRejected":
        return `курс ${v(a, "rate")} отличается от прошлого ${v(a, "prev")} на ${v(a, "pct")}% — не приняли, оставили прежний`;
    }
  })();
  return src ? `${src}: ${body}` : body;
}

/** Записи журнала из JSON; кривые пропускаются (значит, панель покажет строки). */
export function parseAttempts(raw: unknown): RateAttempt[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RateAttempt[] = [];
  for (const x of raw.slice(0, 8)) {
    if (!x || typeof x !== "object") return undefined;
    const r = x as Record<string, unknown>;
    if (!RATE_ATTEMPT_CODES.includes(r.code as RateAttemptCode)) return undefined;
    const vars: Record<string, string | number> = {};
    if (r.vars && typeof r.vars === "object")
      for (const [k, val] of Object.entries(r.vars as Record<string, unknown>))
        if (typeof val === "string" || typeof val === "number") vars[k] = val;
    out.push({
      code: r.code as RateAttemptCode,
      ...(typeof r.src === "string" ? { src: r.src } : {}),
      ...(r.via === "relay" || r.via === "noReferer" ? { via: r.via } : {}),
      ...(Object.keys(vars).length ? { vars } : {}),
    });
  }
  return out;
}
