/**
 * Сообщения Telegram одного уведомления продавцу о заказе (текст, чек) — чтобы
 * после «подтвердить»/«отклонить» снять кнопки сразу, а через 5 минут убрать
 * их из чата, как в v1 (src/lib/admin-order-notify.ts). Ключ app_settings —
 * `v2_order_notify:<id>`, не v1-шный: крон v1 чистит «admin_notify_tg:*» по
 * всей таблице без bot_id.
 */
export type AdminNotifyTgRef = { chat_id: string; message_id: number; buttons?: boolean };

export type AdminNotifyPack = {
  refs: AdminNotifyTgRef[];
  deleteAfter: string | null;
  /** Когда пачка появилась — по нему чистится пачка, по которой решения так и не было. */
  createdAt?: string;
};

/**
 * Пачка без решения (заказ так и не подтвердили и не отклонили) живёт не
 * дольше недели — как неоплаченный заказ в ночной чистке v1. Telegram всё
 * равно не даёт удалять сообщения старше 48 часов, поэтому убирается только
 * запись в app_settings.
 */
export const ADMIN_NOTIFY_STALE_MS = 7 * 24 * 3600_000;

/** После решения пачка ещё 5 минут видна — продавец успеет переслать её коллегам. */
export const ADMIN_NOTIFY_DISMISS_DELAY_MS = 5 * 60 * 1000;

export const ORDER_NOTIFY_KEY_PREFIX = "v2_order_notify:";

export function adminNotifySettingKey(orderId: number): string {
  return `${ORDER_NOTIFY_KEY_PREFIX}${orderId}`;
}

export function isAdminNotifySettingKey(key: string): boolean {
  return key.startsWith(ORDER_NOTIFY_KEY_PREFIX);
}

function refsFromUnknown(value: unknown): AdminNotifyTgRef[] {
  if (!Array.isArray(value)) return [];
  const refs: AdminNotifyTgRef[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const chatId = (row as AdminNotifyTgRef).chat_id;
    const messageId = (row as AdminNotifyTgRef).message_id;
    if (typeof chatId !== "string" || !chatId || !Number.isInteger(messageId)) continue;
    refs.push({
      chat_id: chatId,
      message_id: messageId,
      ...((row as AdminNotifyTgRef).buttons ? { buttons: true } : {}),
    });
  }
  return refs;
}

export function parseAdminNotifyPack(raw: string | null | undefined): AdminNotifyPack {
  const empty: AdminNotifyPack = { refs: [], deleteAfter: null };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return { refs: refsFromUnknown(parsed), deleteAfter: null };
    }
    if (!parsed || typeof parsed !== "object") return empty;
    const record = parsed as { refs?: unknown; deleteAfter?: unknown; createdAt?: unknown };
    return {
      refs: refsFromUnknown(record.refs),
      deleteAfter:
        typeof record.deleteAfter === "string" && record.deleteAfter ? record.deleteAfter : null,
      ...(typeof record.createdAt === "string" && record.createdAt
        ? { createdAt: record.createdAt }
        : {}),
    };
  } catch {
    return empty;
  }
}

export function parseAdminNotifyRefs(raw: string | null | undefined): AdminNotifyTgRef[] {
  return parseAdminNotifyPack(raw).refs;
}

export function isAdminNotifyDue(pack: AdminNotifyPack, now = Date.now()): boolean {
  if (!pack.deleteAfter) return false;
  const at = Date.parse(pack.deleteAfter);
  return Number.isFinite(at) && at <= now;
}

/**
 * Пачка без решения старше недели. Возраст — по createdAt, у пачек, записанных
 * до него, — по updated_at строки app_settings; без обоих — не трогаем.
 */
export function isAdminNotifyStale(
  pack: AdminNotifyPack,
  rowUpdatedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (pack.deleteAfter) return false;
  const at = Date.parse(pack.createdAt ?? rowUpdatedAt ?? "");
  return Number.isFinite(at) && now - at > ADMIN_NOTIFY_STALE_MS;
}

export function collectTgMessageIds(result: unknown): number[] {
  if (!result) return [];
  const rows = Array.isArray(result) ? result : [result];
  const ids: number[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { message_id?: unknown }).message_id;
    if (typeof id === "number" && Number.isInteger(id)) ids.push(id);
  }
  return ids;
}

export function mergeAdminNotifyRefs(
  current: AdminNotifyTgRef[],
  extra: AdminNotifyTgRef[],
): AdminNotifyTgRef[] {
  const byToken = new Map<string, AdminNotifyTgRef>();
  for (const ref of [...current, ...extra]) {
    const token = `${ref.chat_id}:${ref.message_id}`;
    const prev = byToken.get(token);
    byToken.set(token, {
      chat_id: ref.chat_id,
      message_id: ref.message_id,
      ...(prev?.buttons || ref.buttons ? { buttons: true } : {}),
    });
  }
  return [...byToken.values()];
}
