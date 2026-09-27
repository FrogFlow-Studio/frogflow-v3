/**
 * Воронка сделок (модуль crm_pipeline): заказы и заявки на доске по этапам.
 * Чистые правила — без базы, нужны и серверу, и странице в браузере.
 *
 * Этап заказа не хранится: он следует за статусом заказа, и двигать заказ
 * по доске руками нельзя — иначе доска обошла бы оплату и выдачу. Заявка
 * (покупатель без заказа) хранится в app_settings под `crm:lead:<id>`, её
 * этап продавец меняет сам. Своей таблицы у воронки нет: схема базы общая с
 * v1 и не меняется.
 */
export const PIPELINE_STAGES = [
  "new",
  "in_progress",
  "awaiting_payment",
  "paid",
  "won",
  "lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const isPipelineStage = (s: unknown): s is PipelineStage =>
  typeof s === "string" && (PIPELINE_STAGES as readonly string[]).includes(s);

export const isClosedStage = (s: PipelineStage) => s === "won" || s === "lost";

const ORDER_STAGE: Record<string, PipelineStage> = {
  awaiting_payment: "awaiting_payment",
  awaiting_confirmation: "awaiting_payment",
  paid: "paid",
  accepted: "paid",
  in_production: "paid",
  ready: "paid",
  delivering: "paid",
  delivered: "won",
  rejected: "lost",
  cancelled: "lost",
  refunded: "lost",
};

/** Этап заказа по его статусу; незнакомый статус — «В работе», а не пропажа с доски. */
export function orderStage(status: string): PipelineStage {
  return ORDER_STAGE[status] ?? "in_progress";
}

/** Статусы заказа, которые считаются закрытыми для доски. */
export const CLOSED_ORDER_STATUSES = Object.entries(ORDER_STAGE)
  .filter(([, s]) => isClosedStage(s))
  .map(([status]) => status);

export const LEAD_PREFIX = "crm:lead:";
export const leadKey = (id: string) => `${LEAD_PREFIX}${id}`;
const LEAD_ID = /^[a-z0-9][a-z0-9:_-]{0,79}$/i;
export const isLeadId = (id: unknown): id is string => typeof id === "string" && LEAD_ID.test(id);

export type LeadSource = "manual" | "handoff" | "ig_comment" | "chat";
const SOURCES: readonly LeadSource[] = ["manual", "handoff", "ig_comment", "chat"];

export type Lead = {
  id: string;
  stage: PipelineStage;
  name: string;
  contact: string;
  source: LeadSource;
  amount: number | null;
  currency: string | null;
  note: string | null;
  /** Логин из «Команды» или владелец; null — не назначен. */
  owner: string | null;
  created_at: string;
  updated_at: string;
  /** Когда заявка ушла в «Выполнено» или «Потеряна»; по ней чистит ночная уборка. */
  closed_at: string | null;
};

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

const money = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const currency = (v: unknown): string | null => {
  const c = str(v, 3)?.toUpperCase() ?? null;
  return c && /^[A-Z]{3}$/.test(c) ? c : null;
};

export function parseLead(raw: string | null | undefined): Lead | null {
  let p: Record<string, unknown>;
  try {
    const v = JSON.parse(raw || "null") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    p = v as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isLeadId(p.id) || !isPipelineStage(p.stage)) return null;
  const name = str(p.name, 120);
  const contact = str(p.contact, 120);
  if (!name && !contact) return null;
  const created = str(p.created_at, 40);
  if (!created) return null;
  return {
    id: p.id,
    stage: p.stage,
    name: name ?? "",
    contact: contact ?? "",
    source: SOURCES.includes(p.source as LeadSource) ? (p.source as LeadSource) : "manual",
    amount: money(p.amount),
    currency: currency(p.currency),
    note: str(p.note, 1000),
    owner: str(p.owner, 64),
    created_at: created,
    updated_at: str(p.updated_at, 40) ?? created,
    closed_at: str(p.closed_at, 40),
  };
}

export type LeadInput = {
  name?: unknown;
  contact?: unknown;
  amount?: unknown;
  currency?: unknown;
  note?: unknown;
};

/** Ввод продавца: обрезка и проверка; без имени и контакта заявку не завести. */
export function sanitizeLeadInput(i: LeadInput) {
  const name = str(i.name, 120);
  const contact = str(i.contact, 120);
  if (!name && !contact) throw new Error("Нужно имя или контакт покупателя.");
  return {
    name: name ?? "",
    contact: contact ?? "",
    amount: money(i.amount),
    currency: currency(i.currency),
    note: str(i.note, 1000),
  };
}
