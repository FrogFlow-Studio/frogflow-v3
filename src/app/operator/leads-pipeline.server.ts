import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { escapeHtml } from "@/channels/telegram/copy";
import { reportError } from "@/lib/errors";
import { serverFailure } from "@/lib/server-failure";
import {
  normalizePipelineConfig,
  planLead,
  type PipelineConfig,
  type PipelineLead,
} from "@/core/leads/pipeline";
import { LEAD_STAGE_LABEL, isLeadStage } from "@/core/leads/leads";
import { setLeadStage, type LeadRow } from "./leads.server";

/**
 * Крон `leads`: конвейер лидов отдела продаж (core/leads/pipeline). Таблица
 * `sales_leads` общая с v1, у которого свой крон по ней же, поэтому флаг
 * `v3_lead_cron` (своё имя, чтобы не совпасть с ключами v1) в operator_settings по умолчанию выключен: включать только после
 * того, как v1 перестал вести лидов. Тут нет арендатора, клиент v1 не задет.
 */
export const PIPELINE_CONFIG_KEY = "v3_lead_cron";
const ACTOR = "cron";
const DAY = 86_400_000;
/** Сколько лидов показать в одном сообщении оператору. */
const MESSAGE_LIMIT = 15;

export async function getPipelineConfig(): Promise<PipelineConfig> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", PIPELINE_CONFIG_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`настройки крона лидов не прочитаны: ${error.message}`);
  return normalizePipelineConfig(data?.value);
}

export async function savePipelineConfig(input: PipelineConfig): Promise<PipelineConfig> {
  const cfg = normalizePipelineConfig(input);
  const { error } = await serviceDb()
    .from("operator_settings")
    .upsert({ key: PIPELINE_CONFIG_KEY, value: JSON.stringify(cfg) }, { onConflict: "key" });
  if (error) throw serverFailure(`настройки крона лидов не сохранены: ${error.message}`);
  return cfg;
}

export type PipelineResult =
  | { enabled: false }
  | {
      enabled: true;
      lost: number;
      hints: number;
      reminded: number;
      failed: number;
      message: "sent" | "not_configured" | "failed" | "none";
    };

type Reminder = { name: string; stage: string; action: string | null };

async function writeEvent(leadId: string, kind: string, detail: string) {
  const { error } = await serviceDb()
    .from("sales_lead_events")
    .insert({ lead_id: leadId, actor: ACTOR, kind, detail: detail.slice(0, 500) });
  if (error) throw serverFailure(`событие лида не записано: ${error.message}`);
}

/** Подсказка «следующее действие»: пишется, только пока поле пустое. */
async function setHint(l: LeadRow, text: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("sales_leads")
    .update({ next_action: text })
    .eq("id", l.id)
    .eq("stage", l.stage)
    .is("next_action", null)
    .select("id");
  if (error) throw serverFailure(`подсказка лида не сохранена: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Напоминание «один раз»: срок следующего шага сдвигается условной записью
 * (стадия и прежний срок не изменились), и только выигравший прогон шлёт.
 */
async function claimReminder(l: LeadRow, cfg: PipelineConfig, now: Date): Promise<boolean> {
  const q = serviceDb()
    .from("sales_leads")
    .update({ next_action_at: new Date(now.getTime() + cfg.followUpDays * DAY).toISOString() })
    .eq("id", l.id)
    .eq("stage", l.stage);
  const { data, error } = await (
    l.next_action_at ? q.eq("next_action_at", l.next_action_at) : q.is("next_action_at", null)
  ).select("id");
  if (error) throw serverFailure(`напоминание о лиде не отмечено: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

function reminderText(items: Reminder[], more: number, panelUrl: string): string {
  const lines = items.map(
    (r) =>
      `• ${escapeHtml(r.name)} — ${escapeHtml(isLeadStage(r.stage) ? LEAD_STAGE_LABEL[r.stage] : r.stage)}` +
      (r.action ? `: ${escapeHtml(r.action)}` : ""),
  );
  if (more > 0) lines.push(`…и ещё ${more}`);
  return [
    "📋 <b>Лиды ждут вашего шага</b>",
    ...lines,
    `<a href="${escapeHtml(panelUrl)}">Открыть лидов в панели</a>`,
  ].join("\n");
}

export async function runLeadPipeline(now = new Date()): Promise<PipelineResult> {
  const cfg = await getPipelineConfig();
  if (!cfg.enabled) return { enabled: false };
  let leads: LeadRow[];
  try {
    leads = await pageAll<LeadRow>(
      (from, to) =>
        serviceDb()
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
  const out = { lost: 0, hints: 0, reminded: 0, failed: 0 };
  const reminders: Reminder[] = [];
  for (const l of leads) {
    const plan = planLead(l as PipelineLead, now, cfg);
    try {
      if (plan.lose) {
        const r = await setLeadStage(
          {
            id: l.id,
            from: l.stage,
            to: "lost",
            lostReason: `Нет ответа ${cfg.lostDays} дн.`,
          },
          ACTOR,
          now,
        );
        if (r.ok) out.lost++;
        continue;
      }
      let action = l.next_action;
      if (plan.nextAction && (await setHint(l, plan.nextAction))) {
        out.hints++;
        action = plan.nextAction;
      }
      if (plan.remind && (await claimReminder(l, cfg, now))) {
        await writeEvent(l.id, "reminder", "Напоминание оператору о следующем шаге");
        reminders.push({ name: l.business_name, stage: l.stage, action });
        out.reminded++;
      }
    } catch (e) {
      out.failed++;
      await reportError(e, { where: "cron:leads" });
    }
  }
  let message: "sent" | "not_configured" | "failed" | "none" = "none";
  if (reminders.length > 0) {
    const { sendOperatorAlert } = await import("./health-alerts.server");
    const panelUrl = `${env().APP_URL.replace(/\/$/, "")}/operator/leads`;
    const r = await sendOperatorAlert(
      reminderText(reminders.slice(0, MESSAGE_LIMIT), reminders.length - MESSAGE_LIMIT, panelUrl),
    );
    message = r.ok ? "sent" : r.reason;
  }
  return { enabled: true, ...out, message };
}
