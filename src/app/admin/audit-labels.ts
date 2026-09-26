import { adminT, type AdminKey } from "@/app/i18n/admin";
import { ru } from "@/app/i18n/admin/audit";
import type { Json } from "@/core/db-types";
import { ADMIN_AUDIT_ACTOR_PREFIX, toAuditEntry } from "@/core/audit/admin-audit";
import type { Locale } from "@/core/i18n/locale";

/** Подпись действия из журнала на языке панели; неизвестное — как есть. */
export function auditActionLabel(locale: Locale, action: string): string {
  const key = `audit.action.${action}`;
  return key in ru ? adminT(locale)(key as AdminKey) : action;
}

/** Подробности одной строкой: «name: Торт · price: 5000». */
export function auditDetailsText(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 300);
}

/**
 * Строка bot_events от команды магазина — подпись и подробности для
 * журналов оператора; null — событие оператора или платформы.
 */
export function shopEventView(e: {
  id: string;
  at: string;
  actor: string;
  payload: Json;
}): { title: string; details: string } | null {
  if (!e.actor.startsWith(ADMIN_AUDIT_ACTOR_PREFIX)) return null;
  const entry = toAuditEntry(e);
  return { title: auditActionLabel("ru", entry.action), details: auditDetailsText(entry.details) };
}
