/**
 * Воронка лидов оператора — отдел продаж самой FrogFlow (таблицы `sales_leads`
 * и `sales_lead_events`, общие с v1). Чистые правила: стадии, разбор формы,
 * нормализация контактов, счётчики. ИИ-оценка — в score.ts. Автопоиск и
 * рассылки v1 сюда не перенесены: они тратят деньги и пишут людям.
 */

export const LEAD_STAGES = [
  "new",
  "qualified",
  "contacted",
  "replied",
  "hot",
  "converted",
  "rejected",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  new: "Новый",
  qualified: "Подходит",
  contacted: "Написали",
  replied: "Ответил",
  hot: "Горячий",
  converted: "Клиент",
  rejected: "Не подходит",
  lost: "Потерян",
};

export function isLeadStage(v: unknown): v is LeadStage {
  return typeof v === "string" && (LEAD_STAGES as readonly string[]).includes(v);
}

const clip = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s ? s.slice(0, max) : null;
};

/** Instagram: «@name», ссылка на профиль или имя — в имя без «@» и параметров. */
export function normalizeHandle(raw: unknown): string | null {
  const s = clip(raw, 200);
  if (!s) return null;
  const fromUrl = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(s)?.[1];
  const h = (fromUrl ?? s).replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

/** Телефон: только цифры, 10–15; «+» не храним — как пишут в WhatsApp-ссылках. */
export function normalizePhone(raw: unknown): string | null {
  const digits = (typeof raw === "string" ? raw : "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** Сайт: без протокола и хвостового слэша, в нижнем регистре; без точки — не сайт. */
export function normalizeSiteUrl(raw: unknown): string | null {
  const s = clip(raw, 300);
  if (!s) return null;
  const host = s
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return host.includes(".") && !/\s/.test(host) ? host : null;
}

export type LeadInput = {
  businessName: string;
  niche: string | null;
  city: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  phone: string | null;
  email: string | null;
  signals: string | null;
};

/** Разбор формы «Новый лид»: название обязательно, хоть один способ связи тоже. */
export function cleanLeadInput(raw: Record<string, unknown>): LeadInput | null {
  const businessName = clip(raw.businessName, 120);
  if (!businessName) return null;
  const email = clip(raw.email, 120)?.toLowerCase() ?? null;
  const input: LeadInput = {
    businessName,
    niche: clip(raw.niche, 80),
    city: clip(raw.city, 80),
    websiteUrl: normalizeSiteUrl(raw.websiteUrl),
    instagramHandle: normalizeHandle(raw.instagramHandle),
    phone: normalizePhone(raw.phone),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    signals: clip(raw.signals, 1000),
  };
  return input.websiteUrl || input.instagramHandle || input.phone || input.email ? input : null;
}

type Contacts = Pick<LeadInput, "websiteUrl" | "instagramHandle" | "phone" | "email">;

/** Тот же лид уже в воронке: совпал Instagram, телефон, почта или сайт. */
export function duplicateOf<T extends Contacts>(existing: T[], input: Contacts): T | null {
  return (
    existing.find(
      (e) =>
        (input.instagramHandle && e.instagramHandle === input.instagramHandle) ||
        (input.phone && e.phone === input.phone) ||
        (input.email && e.email === input.email) ||
        (input.websiteUrl && e.websiteUrl === input.websiteUrl),
    ) ?? null
  );
}

/** Сколько лидов на каждой стадии; стадия, которой нет в списке, считается «Новый». */
export function funnelCounts(rows: Array<{ stage: string }>): Record<LeadStage, number> {
  const out = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
  for (const r of rows) out[isLeadStage(r.stage) ? r.stage : "new"]++;
  return out;
}

/** Метки времени при смене стадии: первое «написали» и первый «ответил» не затираются. */
export function stageTimestamps(
  to: LeadStage,
  lead: { contacted_at: string | null; replied_at: string | null },
  now: Date,
): { contacted_at?: string; replied_at?: string } {
  const iso = now.toISOString();
  if (to === "contacted" && !lead.contacted_at) return { contacted_at: iso };
  if ((to === "replied" || to === "hot") && !lead.replied_at) return { replied_at: iso };
  return {};
}

/** Строка журнала касаний. */
export function stageEventDetail(from: string, to: LeadStage): string {
  const label = (s: string) => (isLeadStage(s) ? LEAD_STAGE_LABEL[s] : s);
  return `${label(from)} → ${LEAD_STAGE_LABEL[to]}`;
}

/** Поиск по списку: название, город, ниша, контакты, заметки. */
export function leadMatches(
  lead: Partial<Record<string, string | number | null>>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    lead.business_name,
    lead.city,
    lead.niche,
    lead.instagram_handle,
    lead.phone,
    lead.email,
    lead.website_url,
    lead.notes,
  ].some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}
