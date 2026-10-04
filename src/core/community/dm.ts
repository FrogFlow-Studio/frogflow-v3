import type { Tenant, TenantSettings } from "@/core/tenant/types";
import { shownInCommunity, takesPartInCommunity } from "./profile";

/**
 * Правила личных сообщений между авторами (С3). Чистые функции — без базы.
 * Писать может автор, который сам в сообществе и не заблокирован оператором; адресат должен быть
 * виден в сообществе, не отключить личные сообщения и не запретить писать именно этому автору.
 */
export const DM_LIMITS = { body: 2000, blocked: 200, perHour: 20, perPairHour: 5 } as const;

export type DmVerdict = "ok" | "senderNotJoined" | "recipientUnavailable" | "dmOff" | "blocked";

export function dmBlockedList(settings: TenantSettings): string[] {
  const raw = settings.community?.dm_blocked;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(
    0,
    DM_LIMITS.blocked,
  );
}

export const dmOff = (settings: TenantSettings): boolean => settings.community?.dm_off === true;

export function dmVerdict(
  sender: Pick<Tenant, "id" | "settings">,
  recipient: Pick<Tenant, "id" | "settings"> | null | undefined,
): DmVerdict {
  if (!takesPartInCommunity(sender)) return "senderNotJoined";
  if (!recipient || recipient.id === sender.id || !shownInCommunity(recipient))
    return "recipientUnavailable";
  if (dmOff(recipient.settings)) return "dmOff";
  if (dmBlockedList(recipient.settings).includes(sender.id)) return "blocked";
  return "ok";
}

export function cleanDm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, DM_LIMITS.body);
  return s || null;
}

export function dmSpam(counts: {
  lastHour: number;
  toThisAuthorLastHour: number;
}): "ok" | "hour" | "pair" {
  if (counts.lastHour >= DM_LIMITS.perHour) return "hour";
  if (counts.toThisAuthorLastHour >= DM_LIMITS.perPairHour) return "pair";
  return "ok";
}
