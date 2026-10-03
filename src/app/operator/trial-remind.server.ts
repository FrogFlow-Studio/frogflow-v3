import { serviceDb } from "@/core/db/client.server";
import { inChunks } from "@/lib/in-chunks";
import { reportError } from "@/lib/errors";
import { readPolicy } from "@/core/billing/subscription";
import { updateSettingAtomic } from "@/core/settings/settings";
import { tenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { adminLocale } from "@/app/admin/locale.server";
import { todayInTz } from "@/core/fulfillment/pure";
import { afterTrial, dueStage, trialState, type TrialStage } from "@/core/plans/trial";
import { notifyOwner } from "./operator.server";

/** Отметки отправленных напоминаний («d3,last») — app_settings клиента. */
export const TRIAL_REMINDED_KEY = "trial_reminded";

export type TrialNotify = (botId: string, text: string) => Promise<boolean>;

const defaultNotify: TrialNotify = async (botId, text) => {
  try {
    return (await notifyOwner(botId, text)).delivered.length > 0;
  } catch {
    return false;
  }
};

/** Строка о том, что будет после пробного периода: зависит от политики неоплаты клиента. */
export function afterTrialText(t: AdminT, policy: ReturnType<typeof readPolicy>): string {
  const a = afterTrial(policy);
  return a.mode === "suspend"
    ? t("trial.after.suspend", { grace: a.graceDays })
    : t("trial.after.warn");
}

export function reminderText(
  t: AdminT,
  stage: TrialStage,
  p: { dateLabel: string; daysLeft: number; policy: ReturnType<typeof readPolicy> },
): string {
  const head =
    stage === "last"
      ? t("trial.remind.last", { date: p.dateLabel })
      : t("trial.remind.d3", { date: p.dateLabel, n: p.daysLeft });
  return `${head} ${afterTrialText(t, p.policy)} ${t("trial.remind.where")}`;
}

/** Метка стадии — условной записью до отправки: победитель шлёт, проигравший пропускает. */
async function markStage(ctx: ReturnType<typeof tenantContext>, stage: TrialStage) {
  return updateSettingAtomic(ctx, TRIAL_REMINDED_KEY, (raw) => {
    const have = (raw ?? "").split(",").filter(Boolean);
    return have.includes(stage) ? null : [...have, stage].join(",");
  });
}
async function unmarkStage(ctx: ReturnType<typeof tenantContext>, stage: TrialStage) {
  await updateSettingAtomic(ctx, TRIAL_REMINDED_KEY, (raw) => {
    const have = (raw ?? "").split(",").filter(Boolean);
    return have.includes(stage) ? have.filter((s) => s !== stage).join(",") : null;
  });
}

export type TrialRemindResult = Record<string, "sent" | "skipped" | "failed">;

/**
 * Крон подписок, раз в сутки: продавцу в пробном периоде — одно сообщение за
 * 3 дня до конца и одно в последний день. Только клиенты на v2 (правило 6).
 * Недоставленное снимает метку, и следующий прогон попробует снова.
 */
export async function remindTrials(
  tenants: readonly Tenant[],
  now = new Date(),
  notify: TrialNotify = defaultNotify,
): Promise<TrialRemindResult> {
  const out: TrialRemindResult = {};
  const candidates = tenants.filter(
    (t) => servedByV2(t) && !t.archived && t.status === "active" && t.settings.billing?.trial_until,
  );
  if (!candidates.length) return out;
  const rows = await inChunks(
    candidates.map((t) => t.id),
    (chunk) => serviceDb().from("bots").select("id, subscription_expires_at").in("id", chunk),
    "[trial] сроки подписок не прочитаны",
  );
  const expires = new Map(rows.map((r) => [r.id, r.subscription_expires_at]));
  for (const t of candidates) {
    try {
      const ctx = tenantContext(t);
      const today = todayInTz(ctx.timezone, now);
      const state = trialState(t.settings.billing, expires.get(t.id) ?? null, today);
      if (!state) continue;
      const { getSetting } = await import("@/core/settings/settings");
      const sent = ((await getSetting(ctx, TRIAL_REMINDED_KEY)) ?? "").split(",");
      const stage = dueStage(state.daysLeft, sent);
      if (!stage) continue;
      if ((await markStage(ctx, stage)) !== "written") {
        out[t.id] = "skipped";
        continue;
      }
      const locale = await adminLocale(ctx);
      const tr = adminT(locale);
      const dateLabel = new Date(`${state.until}T12:00:00Z`).toLocaleDateString(
        intlLocale(locale),
        {
          day: "2-digit",
          month: "2-digit",
          timeZone: "UTC",
        },
      );
      const text = reminderText(tr, stage, {
        dateLabel,
        daysLeft: state.daysLeft,
        policy: readPolicy(t.settings),
      });
      if (await notify(t.id, text)) out[t.id] = "sent";
      else {
        await unmarkStage(ctx, stage);
        out[t.id] = "failed";
      }
    } catch (e) {
      await reportError(e, { where: "cron:trial", botId: t.id });
      out[t.id] = "failed";
    }
  }
  return out;
}
