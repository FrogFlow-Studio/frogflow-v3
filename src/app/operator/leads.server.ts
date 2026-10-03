import { serviceDb } from "@/core/db/client.server";
import type { Database } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import {
  duplicateOf,
  stageEventDetail,
  stageTimestamps,
  type LeadInput,
  type LeadStage,
} from "@/core/leads/leads";
import { serverFailure } from "@/lib/server-failure";

/**
 * Воронка лидов оператора (core/leads): таблицы `sales_leads` и
 * `sales_lead_events` общие с v1, закрыты RLS без политик — только service_role.
 * Стадию v1 тоже двигает (конвейер), поэтому смена стадии условная: пишет
 * только тот, кто видел текущую стадию, и только он оставляет событие.
 */
export type LeadRow = Database["public"]["Tables"]["sales_leads"]["Row"];
export type LeadEventRow = Database["public"]["Tables"]["sales_lead_events"]["Row"];

export async function listLeads(): Promise<LeadRow[]> {
  const db = serviceDb();
  try {
    return await pageAll<LeadRow>(
      (from, to) =>
        db
          .from("sales_leads")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "лиды не прочитаны",
    );
  } catch (e) {
    throw serverFailure(e instanceof Error ? e.message : "лиды не прочитаны");
  }
}

async function logEvent(leadId: string, actor: string, kind: string, detail: string) {
  const { error } = await serviceDb()
    .from("sales_lead_events")
    .insert({ lead_id: leadId, actor, kind, detail: detail.slice(0, 500) });
  if (error) throw serverFailure(`событие лида не записано: ${error.message}`);
}

export type AddLeadResult = { ok: true; id: string } | { ok: false; duplicate: string };

export async function addLead(input: LeadInput, actor: string): Promise<AddLeadResult> {
  const existing = duplicateOf(
    (await listLeads()).map((l) => ({
      id: l.id,
      name: l.business_name,
      websiteUrl: l.website_url,
      instagramHandle: l.instagram_handle,
      phone: l.phone,
      email: l.email,
    })),
    input,
  );
  if (existing) return { ok: false, duplicate: existing.name };
  const { data, error } = await serviceDb()
    .from("sales_leads")
    .insert({
      business_name: input.businessName,
      niche: input.niche,
      city: input.city,
      website_url: input.websiteUrl,
      instagram_handle: input.instagramHandle,
      phone: input.phone,
      email: input.email,
      signals: input.signals,
      source: "manual",
      stage: "new",
      created_by: actor,
    })
    .select("id")
    .single();
  if (error || !data) throw serverFailure(`лид не сохранён: ${error?.message ?? "нет ответа"}`);
  await logEvent(data.id, actor, "created", "Добавлен вручную");
  return { ok: true, id: data.id };
}

export type SetStageResult = { ok: true } | { ok: false; reason: "not_found" | "changed" };

/** Смена стадии: `from` — стадия, которую оператор видел; ушла в другую (v1, вторая вкладка) — отказ. */
export async function setLeadStage(
  p: { id: string; from: string; to: LeadStage; lostReason?: string | null },
  actor: string,
  now = new Date(),
): Promise<SetStageResult> {
  const db = serviceDb();
  const { data: lead, error } = await db
    .from("sales_leads")
    .select("id, stage, contacted_at, replied_at")
    .eq("id", p.id)
    .maybeSingle();
  if (error) throw serverFailure(`лид не прочитан: ${error.message}`);
  if (!lead) return { ok: false, reason: "not_found" };
  if (lead.stage === p.to || lead.stage !== p.from) return { ok: false, reason: "changed" };
  const patch = {
    stage: p.to,
    updated_at: now.toISOString(),
    last_touch_at: now.toISOString(),
    ...stageTimestamps(p.to, lead, now),
    ...(p.to === "lost" ? { lost_reason: p.lostReason?.trim().slice(0, 300) || null } : {}),
  };
  const { data: won, error: writeError } = await db
    .from("sales_leads")
    .update(patch)
    .eq("id", p.id)
    .eq("stage", p.from)
    .select("id");
  if (writeError) throw serverFailure(`стадия лида не сохранена: ${writeError.message}`);
  if (!won || won.length === 0) return { ok: false, reason: "changed" };
  await logEvent(p.id, actor, "stage", stageEventDetail(p.from, p.to));
  return { ok: true };
}

/** Заметки и следующий шаг: пишутся только эти поля, остальное (стадию, оценку v1) не трогаем. */
export async function saveLeadNote(
  p: { id: string; notes: string | null; nextAction: string | null; nextActionAt: string | null },
  now = new Date(),
): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("sales_leads")
    .update({
      notes: p.notes?.trim().slice(0, 4000) || null,
      next_action: p.nextAction?.trim().slice(0, 300) || null,
      next_action_at: p.nextActionAt,
      updated_at: now.toISOString(),
    })
    .eq("id", p.id)
    .select("id");
  if (error) throw serverFailure(`заметка лида не сохранена: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function listLeadEvents(leadId: string): Promise<LeadEventRow[]> {
  const db = serviceDb();
  try {
    return await pageAll<LeadEventRow>(
      (from, to) =>
        db
          .from("sales_lead_events")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "события лида не прочитаны",
    );
  } catch (e) {
    throw serverFailure(e instanceof Error ? e.message : "события лида не прочитаны");
  }
}
