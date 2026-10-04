import { servedByV2 } from "@/core/tenant/directory";
import type { Tenant, TenantSettings } from "@/core/tenant/types";

/**
 * Профиль автора в сообществе (путь С, С1). Хранится в `bots.settings.community`,
 * решение оператора — в `bots.settings.community_mod`; схема базы не меняется.
 * Сообщество по согласию: пока автор сам не включил «Показывать меня в
 * сообществе» и не назвал себя, его не видно и он ничего не читает и не пишет.
 */
export const COMMUNITY_LIMITS = {
  name: 80,
  niche: 80,
  city: 60,
  about: 600,
  links: 5,
  link: 200,
  reason: 300,
} as const;

export type CommunityProfile = {
  enabled: boolean;
  name: string;
  niche: string;
  city: string;
  about: string;
  links: string[];
};

export type CommunityMod = { status: "hidden" | "blocked"; reason: string; at: string };

/**
 * off — выключено или не заполнено; visible — виден авторам;
 * hidden — оператор скрыл: автора не показываем, остальное работает;
 * blocked — оператор заблокировал: не виден, не читает и не пишет.
 */
export type CommunityState = "off" | "visible" | "hidden" | "blocked";

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Ссылка автора: только http(s), без повторов, не больше пяти. */
export function cleanLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === "string" ? v.trim().slice(0, COMMUNITY_LIMITS.link) : "";
    if (!/^https?:\/\/[^\s]+$/i.test(s)) continue;
    try {
      new URL(s);
    } catch {
      continue;
    }
    if (!out.includes(s)) out.push(s);
    if (out.length >= COMMUNITY_LIMITS.links) break;
  }
  return out;
}

export function cleanProfile(raw: unknown): CommunityProfile {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: r.enabled === true,
    name: text(r.name, COMMUNITY_LIMITS.name),
    niche: text(r.niche, COMMUNITY_LIMITS.niche),
    city: text(r.city, COMMUNITY_LIMITS.city),
    about: text(r.about, COMMUNITY_LIMITS.about),
    links: cleanLinks(r.links),
  };
}

export const communityProfile = (settings: TenantSettings): CommunityProfile =>
  cleanProfile(settings.community);

export function communityMod(settings: TenantSettings): CommunityMod | null {
  const m = settings.community_mod;
  if (!m || (m.status !== "hidden" && m.status !== "blocked")) return null;
  return {
    status: m.status,
    reason: text(m.reason, COMMUNITY_LIMITS.reason),
    at: typeof m.at === "string" ? m.at : "",
  };
}

/** Состояние автора. Магазин клиента прежней платформы в сообществе не участвует. */
export function communityState(t: Pick<Tenant, "settings">): CommunityState {
  if (!servedByV2(t)) return "off";
  const mod = communityMod(t.settings);
  if (mod?.status === "blocked") return "blocked";
  const p = communityProfile(t.settings);
  if (!p.enabled || !p.name) return "off";
  return mod?.status === "hidden" ? "hidden" : "visible";
}

/** Автора видят другие авторы. */
export const shownInCommunity = (t: Pick<Tenant, "settings">): boolean =>
  communityState(t) === "visible";

/** Автор читает и пишет в сообществе (скрытый оператором ещё может, заблокированный нет). */
export const takesPartInCommunity = (t: Pick<Tenant, "settings">): boolean => {
  const s = communityState(t);
  return s === "visible" || s === "hidden";
};

/** Публичная карточка автора для других авторов; без владельца, токенов и настроек. */
export type CommunityAuthor = Pick<CommunityProfile, "name" | "niche" | "city" | "about" | "links">;

export function authorCard(t: Pick<Tenant, "settings">): CommunityAuthor | null {
  if (!shownInCommunity(t)) return null;
  const { name, niche, city, about, links } = communityProfile(t.settings);
  return { name, niche, city, about, links };
}
