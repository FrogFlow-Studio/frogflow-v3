import { cleanLeadInput } from "@/core/leads/leads";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { PLAN_TIERS, type PlanTier } from "@/core/plans/registry";
import { VERTICALS, type VerticalKey } from "@/core/verticals/registry";

/**
 * Заявка «Открыть свой магазин» с площадки (В19). Заявка — лид в воронке оператора
 * (`sales_leads`, источник `market_open`): схема базы не меняется. Выбранная ниша, тариф и
 * язык лежат в начале `signals` отметкой `[ff-open v=… t=… l=…]` — по ней оператор одной
 * кнопкой создаёт магазин (app/operator/open-shop.server).
 */
export const OPEN_VERTICALS = ["confectionery", "flowers", "digital", "courses"] as const;
export type OpenVertical = (typeof OPEN_VERTICALS)[number];

export const OPEN_SOURCE = "market_open";
/** Лиды площадки: не больше с одного адреса и всего за сутки. */
export const OPEN_LIMITS = { perIpPerDay: 3, totalPerDay: 40 } as const;

export type OpenRequest = {
  vertical: OpenVertical;
  tier: PlanTier;
  locale: Locale;
  businessName: string;
  phone: string | null;
  email: string | null;
  instagramHandle: string | null;
  city: string | null;
  comment: string | null;
};

export type OpenRequestError = "niche" | "tier" | "name" | "contact";

export const isOpenVertical = (v: unknown): v is OpenVertical =>
  typeof v === "string" && (OPEN_VERTICALS as readonly string[]).includes(v);

export const isTier = (v: unknown): v is PlanTier =>
  typeof v === "string" && (PLAN_TIERS as readonly string[]).includes(v);

const clip = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s ? s.slice(0, max) : null;
};

/** Разбор формы: ниша и тариф из списка, название и хоть один контакт обязательны. */
export function cleanOpenRequest(
  raw: Record<string, unknown>,
): { ok: true; value: OpenRequest } | { ok: false; error: OpenRequestError } {
  if (!isOpenVertical(raw.vertical)) return { ok: false, error: "niche" };
  if (!isTier(raw.tier)) return { ok: false, error: "tier" };
  if (!clip(raw.businessName, 120)) return { ok: false, error: "name" };
  const lead = cleanLeadInput({
    businessName: raw.businessName,
    city: raw.city,
    phone: raw.phone,
    email: raw.email,
    instagramHandle: raw.instagramHandle,
  });
  if (!lead) return { ok: false, error: "contact" };
  return {
    ok: true,
    value: {
      vertical: raw.vertical,
      tier: raw.tier,
      locale: isLocale(raw.locale) ? raw.locale : "ru",
      businessName: lead.businessName,
      phone: lead.phone,
      email: lead.email,
      instagramHandle: lead.instagramHandle,
      city: lead.city,
      comment: clip(raw.comment, 500),
    },
  };
}

export const requestMarker = (v: OpenVertical, t: PlanTier, l: Locale): string =>
  `[ff-open v=${v} t=${t} l=${l}]`;

const MARKER = /^\[ff-open v=([a-z_]+) t=([a-z]+) l=([a-z]{2})\]/;

/** Ниша, тариф и язык заявки из `signals` лида; не заявка с площадки — null. */
export function parseRequestMarker(
  signals: string | null | undefined,
): { vertical: OpenVertical; tier: PlanTier; locale: Locale } | null {
  const m = MARKER.exec(signals ?? "");
  if (!m || !isOpenVertical(m[1]) || !isTier(m[2]) || !isLocale(m[3])) return null;
  return { vertical: m[1], tier: m[2], locale: m[3] };
}

/** Текст в `signals` лида: отметка, затем то, что видит оператор. */
export function requestSignals(r: OpenRequest): string {
  const parts = [
    requestMarker(r.vertical, r.tier, r.locale),
    `Заявка с площадки. Ниша: ${VERTICALS[r.vertical as VerticalKey].title}. Тариф: ${r.tier}. Язык: ${r.locale}.`,
  ];
  if (r.comment) parts.push(`Комментарий: ${r.comment}`);
  return parts.join(" ").slice(0, 1000);
}

/** Какой лимит сработал, если сработал: по адресу или общий за сутки. */
export function openVerdict(counts: { ip: number; total: number }): "ip" | "total" | null {
  if (counts.ip >= OPEN_LIMITS.perIpPerDay) return "ip";
  if (counts.total >= OPEN_LIMITS.totalPerDay) return "total";
  return null;
}
