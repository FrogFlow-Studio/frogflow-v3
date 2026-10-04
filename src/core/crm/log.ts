import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, updateSettingStamped } from "@/core/settings/settings";

/**
 * Журнал доставки вебхуков магазина: кольцо последних 100 отправок в
 * `app_settings` (схема заморожена). Пишется с условием по метке записи
 * (updateSettingStamped): два события одновременно не затирают друг друга.
 * В журнал идут только событие, заказ, код ответа и время — ни тела, ни
 * секрета, ни адреса.
 */
export const CRM_LOG_KEY = "crm_webhook_log";
export const CRM_LOG_MAX = 100;

/** ok — ответ 2xx/302; http — другой код (в `status`); timeout — ответа не дождались; network — обрыв до ответа; blocked — адрес запрещён. */
export type CrmOutcome = "ok" | "http" | "timeout" | "network" | "blocked";

export type CrmLogEntry = {
  at: string;
  event: string;
  /** Номер заказа в базе; у проверочного ping — null. */
  orderId: number | null;
  /** Идентификатор события в теле: по нему CRM отбрасывает дубль. */
  eventId: string | null;
  outcome: CrmOutcome;
  status: number | null;
  /** Строка очереди «Не доставлено» (zernio_logs.id): по ней событие повторяют вручную. */
  outboxId?: string;
};

function parseLog(raw: string | null): CrmLogEntry[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as CrmLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Дописать запись; старые вытесняются сверх 100. Сбой записи отправку не срывает. */
export async function recordCrmDelivery(ctx: TenantContext, entry: CrmLogEntry): Promise<boolean> {
  try {
    const r = await updateSettingStamped(ctx, CRM_LOG_KEY, (raw) =>
      JSON.stringify([...parseLog(raw), entry].slice(-CRM_LOG_MAX)),
    );
    return r === "written";
  } catch {
    return false;
  }
}

/** Журнал от новых к старым. Сбой чтения — ошибка, а не «журнал пуст». */
export async function loadCrmLog(ctx: TenantContext): Promise<CrmLogEntry[]> {
  return parseLog(await getSettingStrict(ctx, CRM_LOG_KEY)).reverse();
}

/** Что записать в журнал по телу события и ответу адресата. */
export function logEntryFor(
  body: string,
  r:
    | { ok: true; status: number }
    | { ok: false; error: string; timedOut?: boolean; status?: number },
  meta: { outboxId?: string } = {},
  now = new Date(),
): CrmLogEntry {
  let event = "order";
  let orderId: number | null = null;
  let eventId: string | null = null;
  try {
    const p = JSON.parse(body) as {
      event?: unknown;
      event_id?: unknown;
      order?: { id?: unknown };
    };
    if (typeof p.event === "string") event = p.event;
    if (typeof p.event_id === "string") eventId = p.event_id;
    const id = Number(p.order?.id);
    if (Number.isInteger(id) && id > 0) orderId = id;
  } catch {
    /* тело — как есть */
  }
  const base = {
    at: now.toISOString(),
    event,
    orderId,
    eventId,
    ...(meta.outboxId ? { outboxId: meta.outboxId } : {}),
  };
  if (r.ok) {
    const good = (r.status >= 200 && r.status < 300) || r.status === 302;
    return { ...base, outcome: good ? "ok" : "http", status: r.status };
  }
  if (r.status) return { ...base, outcome: "http", status: r.status };
  if (r.timedOut) return { ...base, outcome: "timeout", status: null };
  return { ...base, outcome: "network", status: null };
}
