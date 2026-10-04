/**
 * Приглашение в команду магазина по ссылке (bots.settings.admin.invites).
 * Секрет есть только в ссылке; в настройках — его sha256. Приглашение
 * одноразовое (принявший удаляет запись) и со сроком.
 */
import type { AdminInvite } from "@/core/tenant/types";

export const INVITE_TTL_MS = 7 * 86_400_000;
/** Сколько приглашений может висеть одновременно. */
export const MAX_PENDING_INVITES = 20;

export const inviteUsable = (i: AdminInvite, now: number) => Date.parse(i.expires_at) > now;

/** Живые приглашения; просроченные при каждой записи убираются из настроек. */
export const liveInvites = (invites: readonly AdminInvite[] | undefined, now: number) =>
  (invites ?? []).filter((i) => inviteUsable(i, now));
