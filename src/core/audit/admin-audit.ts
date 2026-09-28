import type { Json } from "@/core/db-types";

/**
 * Журнал действий в админке продавца: кто из команды магазина, что и когда
 * поменял. Пишется одной прослойкой (src/start.ts) после каждой успешной
 * серверной функции админки, в bot_events рядом с действиями оператора —
 * схема не меняется: kind "meta", actor "admin:<логин>", payload
 * { action: <имя функции>, ...подробности }.
 *
 * Пишем всё, что меняет магазин, кроме заказов (у них своя история в
 * карточке заказа), переписки с покупателями и действий без изменений
 * (предпросмотр, проверка, ссылка). Новая серверная функция админки попадает
 * в журнал сама — чтобы не попала, её надо явно внести в NOT_AUDITED.
 */
export const ADMIN_AUDIT_ACTOR_PREFIX = "admin:";
export const ADMIN_AUDIT_KIND = "meta" as const;

const NOT_AUDITED = new Set([
  // заказы
  "orderActionFn",
  "orderNoteFn",
  "createManualOrderFn",
  "recordPaymentFn",
  "refundOrderFn",
  "sendApprovalFn",
  "rejectBalanceProofFn",
  "updateFulfillmentFn",
  "outboxActionFn",
  // переписка с покупателями
  "chatReplyFn",
  "chatConnectFn",
  "inboxSetFn",
  // вход и выход — в admin_login_attempts
  "adminLogin",
  "adminLogout",
  // ничего не меняют
  "previewQuizFn",
  "consultantTestFn",
  "testCrmFn",
  "vipProofUrlFn",
  "zernioConnectLinkFn",
  "hideSetupFn",
  "hideMovedWelcomeFn",
  "assistDescriptionFn",
  "assistPostFn",
  "assistReviewReplyFn",
]);

const ADMIN_FUNCTIONS_FILE = /(^|\/)src\/app\/admin\/[^/]+\.functions\.ts$/;

/** Имя действия для журнала или null — если вызов в журнал не пишется. */
export function auditedAdminAction(
  meta: { name?: string; filename?: string } | undefined,
  method: string,
): string | null {
  if (method !== "POST" || !meta?.name || !meta.filename) return null;
  if (!ADMIN_FUNCTIONS_FILE.test(meta.filename)) return null;
  return NOT_AUDITED.has(meta.name) ? null : meta.name;
}

export const shopActor = (username: string) => `${ADMIN_AUDIT_ACTOR_PREFIX}${username}`;

const SECRET_FIELD = /pass|secret|token|hash|credential|api_?key|private/i;
const MAX_FIELDS = 12;
const MAX_TEXT = 120;
const MAX_KEY = 40;

/**
 * Подробности действия из входных данных: пароли, токены и ключи — «•••»,
 * длинный текст — только длина, списки — только размер, вложенное — «{…}».
 */
export function auditDetails(data: unknown): Record<string, Json> {
  if (data === null || data === undefined) return {};
  if (typeof data !== "object") return { value: brief("value", data) };
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FIELDS) break;
    // Данные приходят до проверки валидатором: чужие длинные ключи не пишем.
    if (v === null || v === undefined || k.length > MAX_KEY) continue;
    out[k] = brief(k, v);
  }
  return out;
}

function brief(key: string, v: unknown): Json {
  if (SECRET_FIELD.test(key)) return "•••";
  if (typeof v === "string") return v.length > MAX_TEXT ? `(текст, ${v.length} симв.)` : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return `[${v.length}]`;
  return "{…}";
}

/** Строка журнала для показа: кто (логин без префикса), что, подробности. */
export type AuditEntry = {
  id: string;
  at: string;
  who: string;
  action: string;
  details: Record<string, Json>;
};

export function toAuditEntry(row: {
  id: string;
  at: string;
  actor: string;
  payload: Json;
}): AuditEntry {
  const p = (
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {}
  ) as Record<string, Json>;
  const { action, ...details } = p;
  return {
    id: row.id,
    at: row.at,
    who: row.actor.startsWith(ADMIN_AUDIT_ACTOR_PREFIX)
      ? row.actor.slice(ADMIN_AUDIT_ACTOR_PREFIX.length)
      : row.actor,
    action: typeof action === "string" ? action : "",
    details,
  };
}
