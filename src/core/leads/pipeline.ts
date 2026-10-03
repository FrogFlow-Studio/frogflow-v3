import { isLeadStage, type LeadStage } from "./leads";

/**
 * Конвейер лидов (крон `leads`): подсказка «следующее действие» по стадии,
 * напоминание оператору о follow-up и «потерян» после долгого молчания.
 * Ничего никому не отправляет, кроме сообщения самому оператору. Выключен по
 * умолчанию: v1 гоняет свой крон по той же `sales_leads`, и два конвейера на
 * одной таблице спорили бы за стадию и следующий шаг.
 */

export type PipelineConfig = {
  enabled: boolean;
  /** Через сколько дней молчания напомнить о лиде. */
  followUpDays: number;
  /** Через сколько дней молчания после «Написали» перевести в «Потерян». */
  lostDays: number;
};

export const DEFAULT_PIPELINE: PipelineConfig = { enabled: false, followUpDays: 3, lostDays: 14 };

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Настройки из operator_settings (JSON-строка или объект). Включено только явным `true`. */
export function normalizePipelineConfig(raw: unknown): PipelineConfig {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const p: unknown = JSON.parse(raw);
      if (p && typeof p === "object") obj = p as Record<string, unknown>;
    } catch {
      /* пусто — значит по умолчанию */
    }
  } else if (raw && typeof raw === "object") obj = raw as Record<string, unknown>;
  const followUpDays = clampInt(obj.followUpDays, 1, 30, DEFAULT_PIPELINE.followUpDays);
  const lostDays = Math.max(
    followUpDays + 1,
    clampInt(obj.lostDays, 3, 120, DEFAULT_PIPELINE.lostDays),
  );
  return { enabled: obj.enabled === true, followUpDays, lostDays };
}

/** Что сделать дальше по стадии; у закрытых стадий подсказки нет. */
export const NEXT_ACTION: Partial<Record<LeadStage, string>> = {
  new: "Оценить лид",
  qualified: "Написать первое сообщение",
  contacted: "Дождаться ответа или напомнить о себе",
  replied: "Ответить и предложить созвон",
  hot: "Назначить созвон или выставить счёт",
};

const ACTIVE_FOLLOW_UP: readonly LeadStage[] = ["contacted", "replied", "hot"];
const DAY = 86_400_000;

export type PipelineLead = {
  stage: string;
  next_action: string | null;
  next_action_at: string | null;
  last_touch_at: string | null;
  contacted_at: string | null;
  updated_at: string;
  created_at: string;
};

export type LeadPlan = {
  /** Подсказка, если оператор своей не написал. */
  nextAction?: string;
  /** Напомнить оператору: срок следующего шага пришёл или лид молчит. */
  remind?: boolean;
  /** Перевести в «Потерян». */
  lose?: boolean;
};

/** Когда лида последний раз трогали: касание, иначе «Написали», иначе правка карточки. */
export function lastTouch(l: PipelineLead): number {
  const t = Date.parse(l.last_touch_at ?? l.contacted_at ?? l.updated_at ?? l.created_at);
  return Number.isNaN(t) ? 0 : t;
}

/** План по одному лиду. Свой следующий шаг оператора не затирается. */
export function planLead(l: PipelineLead, now: Date, cfg: PipelineConfig): LeadPlan {
  if (!isLeadStage(l.stage)) return {};
  const idle = now.getTime() - lastTouch(l);
  if (l.stage === "contacted" && idle >= cfg.lostDays * DAY) return { lose: true };
  const plan: LeadPlan = {};
  const hint = NEXT_ACTION[l.stage];
  if (hint && !l.next_action?.trim()) plan.nextAction = hint;
  if (ACTIVE_FOLLOW_UP.includes(l.stage)) {
    const dueAt = l.next_action_at ? Date.parse(l.next_action_at) : NaN;
    const due = Number.isNaN(dueAt) ? idle >= cfg.followUpDays * DAY : dueAt <= now.getTime();
    if (due) plan.remind = true;
  }
  return plan;
}
