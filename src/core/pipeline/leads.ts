import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingAtomic } from "@/core/settings/settings";
import {
  LEAD_PREFIX,
  isClosedStage,
  isLeadId,
  leadKey,
  parseLead,
  sanitizeLeadInput,
  type Lead,
  type LeadInput,
  type LeadSource,
  type PipelineStage,
} from "./stages";

/**
 * Заявки воронки — строки app_settings `crm:lead:<id>`, по одной на заявку.
 * Каждая запись — updateSettingAtomic: два сотрудника, поправившие одну
 * заявку одновременно, не затирают друг друга.
 */
export async function createLead(
  ctx: TenantContext,
  input: LeadInput,
  now = new Date(),
  opts: { id?: string; source?: LeadSource; owner?: string | null; userKey?: string | null } = {},
): Promise<Lead> {
  const clean = sanitizeLeadInput(input);
  const id = opts.id ?? randomUUID();
  if (!isLeadId(id)) throw new Error("Неверный идентификатор заявки.");
  const at = now.toISOString();
  const lead: Lead = {
    id,
    stage: "new",
    ...clean,
    source: opts.source ?? "manual",
    owner: opts.owner ?? null,
    user_key: opts.userKey ?? null,
    created_at: at,
    updated_at: at,
    closed_at: null,
  };
  const r = await updateSettingAtomic(ctx, leadKey(id), (raw) =>
    raw == null ? JSON.stringify(lead) : null,
  );
  if (r === "failed") throw new Error("Заявка не сохранилась, попробуйте ещё раз.");
  if (r === "skipped") throw new Error("Такая заявка уже есть.");
  return lead;
}

export type LeadPatch = {
  stage?: PipelineStage;
  note?: string | null;
  owner?: string | null;
  amount?: number | null;
};

/** Изменить заявку; null — такой заявки нет (ничего не создаётся). */
export async function updateLead(
  ctx: TenantContext,
  id: string,
  patch: LeadPatch,
  now = new Date(),
): Promise<Lead | null> {
  if (!isLeadId(id)) return null;
  let next: Lead | null = null;
  const r = await updateSettingAtomic(ctx, leadKey(id), (raw) => {
    const cur = parseLead(raw);
    if (!cur) return null;
    const merged = parseLead(
      JSON.stringify({
        ...cur,
        ...patch,
        id: cur.id,
        created_at: cur.created_at,
        updated_at: now.toISOString(),
      }),
    );
    if (!merged) return null;
    const wasClosed = isClosedStage(cur.stage);
    const closed = isClosedStage(merged.stage);
    merged.closed_at = closed ? (wasClosed ? cur.closed_at : now.toISOString()) : null;
    next = merged;
    return JSON.stringify(merged);
  });
  if (r === "failed") throw new Error("Заявка не сохранилась, попробуйте ещё раз.");
  return r === "written" ? next : null;
}

/** Все заявки магазина; битые строки и чужие ключи пропускаются. */
export async function listLeads(ctx: TenantContext): Promise<Lead[]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .like("key", `${LEAD_PREFIX}%`)
    .limit(2000);
  if (error) throw new Error(`Заявки не прочитались: ${error.message}`);
  const out: Lead[] = [];
  for (const row of data ?? []) {
    if (!row.key.startsWith(LEAD_PREFIX)) continue;
    const lead = parseLead(row.value);
    if (lead && leadKey(lead.id) === row.key) out.push(lead);
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
