import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
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
import {
  LEAD_SCORE_MODEL,
  buildScorePrompt,
  normalizeThresholds,
  parseScore,
  stageForScore,
  type LeadThresholds,
} from "@/core/leads/score";
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

/** Ключ ИИ платформенный (ANTHROPIC_API_KEY): без него кнопка «Оценить» скрыта. */
export function leadsAiAvailable(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY?.trim());
}

const PIPELINE_KEY = "lead_pipeline";

/** Пороги «Подходит»/«Не подходит» из настроек оператора; нет записи — по умолчанию. */
export async function getLeadThresholds(): Promise<LeadThresholds> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", PIPELINE_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`настройки конвейера лидов не прочитаны: ${error.message}`);
  return normalizeThresholds(data?.value);
}

const SCORE_TIMEOUT_MS = 30_000;

export type ScoreLeadResult =
  | { ok: true; score: number; reason: string; movedTo: "qualified" | "rejected" | null }
  | { ok: false; reason: "not_found" | "unreadable" };

/**
 * ИИ-оценка лида: 0–100 и причина пишутся в лид, в журнал уходит событие
 * `scored`. Из «Новый» оценка по порогам двигает лид в «Подходит»/«Не подходит» —
 * через setLeadStage, то есть условно: если стадию успели сменить, оценка
 * остаётся, а стадия нет.
 */
export async function scoreLead(
  id: string,
  actor: string,
  now = new Date(),
): Promise<ScoreLeadResult> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан — оценка лидов недоступна");
  const db = serviceDb();
  const { data: lead, error } = await db.from("sales_leads").select("*").eq("id", id).maybeSingle();
  if (error) throw serverFailure(`лид не прочитан: ${error.message}`);
  if (!lead) return { ok: false, reason: "not_found" };
  const thresholds = await getLeadThresholds();

  let text: string;
  try {
    const response = await new Anthropic({
      apiKey,
      maxRetries: 1,
      timeout: SCORE_TIMEOUT_MS,
    }).messages.create({
      model: LEAD_SCORE_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: buildScorePrompt(lead) }],
    });
    text = response.content.find((b) => b.type === "text")?.text ?? "";
  } catch (e) {
    throw serverFailure(`ИИ-оценка лида ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = parseScore(text);
  if (!parsed) return { ok: false, reason: "unreadable" };

  const { error: writeError } = await db
    .from("sales_leads")
    .update({
      score: parsed.score,
      score_reason: parsed.reason || null,
      updated_at: now.toISOString(),
    })
    .eq("id", id);
  if (writeError) throw serverFailure(`оценка лида не сохранена: ${writeError.message}`);
  await logEvent(
    id,
    actor,
    "scored",
    `Оценка ${parsed.score}${parsed.reason ? `: ${parsed.reason}` : ""}`,
  );

  const to = stageForScore(parsed.score, lead.stage, thresholds);
  let movedTo: "qualified" | "rejected" | null = null;
  if (to && (await setLeadStage({ id, from: lead.stage, to }, actor, now)).ok) movedTo = to;
  return { ok: true, score: parsed.score, reason: parsed.reason, movedTo };
}
