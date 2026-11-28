/**
 * Воронка магазина: пуск и упорядоченные шаги. Шаг — карточка, пауза, ветка
 * по кнопке или дело продавцу. Повтор сохранения не двоит шаги: позиции
 * выдаёт база заново. Отправку заявляет claim до сообщения.
 */

import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";
import type { CardChannel } from "./card";

export const TRIGGER_KINDS = [
  "start",
  "keyword",
  "button",
  "comment",
  "story",
  "broadcast",
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const STEP_KINDS = ["card", "wait", "branch", "case"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type FunnelStep = {
  position: number;
  kind: StepKind;
  payload: Record<string, unknown>;
};

export type Funnel = {
  id: string;
  name: string;
  triggerKind: TriggerKind;
  triggerValue: string;
  rev: number;
  steps: FunnelStep[];
};

export type SaveResult = { id: string; rev: number; saved: boolean; steps: number };

type Row = Record<string, unknown>;

function asFunnel(raw: unknown): Funnel {
  const r = raw as {
    id: string;
    name: string;
    trigger_kind: TriggerKind;
    trigger_value: string;
    rev: number;
    steps: { position: number; kind: StepKind; payload: Record<string, unknown> }[];
  };
  return {
    id: String(r.id),
    name: String(r.name),
    triggerKind: r.trigger_kind,
    triggerValue: String(r.trigger_value ?? ""),
    rev: Number(r.rev),
    steps: (r.steps ?? []).map((s) => ({
      position: Number(s.position),
      kind: s.kind,
      payload: s.payload ?? {},
    })),
  };
}

export async function saveFunnel(
  db: V4Db,
  input: {
    botId: string;
    name: string;
    triggerKind: TriggerKind;
    triggerValue?: string;
    steps: { kind: StepKind; payload?: Record<string, unknown> }[];
    funnelId?: string;
    rev?: number;
  },
): Promise<SaveResult> {
  const args: Record<string, unknown> = {
    p_bot_id: input.botId,
    p_name: input.name,
    p_trigger_kind: input.triggerKind,
    p_trigger_value: input.triggerValue ?? "",
    p_steps: input.steps.map((s) => ({ kind: s.kind, payload: s.payload ?? {} })),
  };
  if (input.funnelId) args.p_funnel_id = input.funnelId;
  if (input.rev != null) args.p_rev = input.rev;
  const row = (await db.call("save_funnel", args))[0]?.save_funnel as Row | undefined;
  if (!row) throw serverFailure("v4.save_funnel: пустой ответ");
  return {
    id: String(row.id),
    rev: Number(row.rev),
    saved: Boolean(row.saved),
    steps: Number(row.steps ?? 0),
  };
}

export async function listFunnels(db: V4Db, botId: string): Promise<Funnel[]> {
  const row = (await db.call("list_funnels", { p_bot_id: botId }))[0]?.list_funnels;
  const list = (typeof row === "string" ? JSON.parse(row) : row) as unknown[] | null;
  return (list ?? []).map(asFunnel);
}

/** true — эту отправку ещё не заявляли. false — уже ушло, второе сообщение не шлём. */
export async function claimFunnelSend(
  db: V4Db,
  input: { botId: string; funnelId: string; externalRef: string },
): Promise<boolean> {
  const row = (
    await db.call("claim_funnel_send", {
      p_bot_id: input.botId,
      p_funnel_id: input.funnelId,
      p_external_ref: input.externalRef,
    })
  )[0]?.claim_funnel_send;
  return Boolean(row);
}

export type StepAction =
  | { type: "card"; step: FunnelStep }
  | { type: "wait"; until: string }
  | { type: "case" }
  | { type: "window" }
  | { type: "done" };

/**
 * Следующее действие. За краем 24 часов у Instagram и WhatsApp карточка не
 * уходит: продавцу дело. Ветка прыгает по номеру шага из payload.goto.
 */
export function stepAction(input: {
  steps: FunnelStep[];
  index: number;
  button?: string;
  startedAt: Date;
  now: Date;
  channel: CardChannel;
  windowOpen: boolean;
}): StepAction {
  const step = input.steps[input.index];
  if (!step) return { type: "done" };
  if (
    (input.channel === "instagram" || input.channel === "whatsapp") &&
    !input.windowOpen &&
    step.kind === "card"
  ) {
    return { type: "window" };
  }
  if (step.kind === "case") return { type: "case" };
  if (step.kind === "wait") {
    const hours = Number(step.payload.hours ?? 0);
    return {
      type: "wait",
      until: new Date(input.startedAt.getTime() + hours * 3600_000).toISOString(),
    };
  }
  if (step.kind === "branch") {
    const expect = String(step.payload.button ?? "");
    if (input.button === expect) {
      const goto = Number(step.payload.goto ?? input.index + 1);
      const next = input.steps.findIndex((s) => s.position === goto);
      return stepAction({
        ...input,
        index: next === -1 ? input.steps.length : next,
        button: undefined,
      });
    }
    return stepAction({ ...input, index: input.index + 1 });
  }
  return { type: "card", step };
}
