/**
 * Фото готового заказа на согласование (торт, букет): продавец шлёт фото
 * из карточки заказа, покупатель отвечает «всё нравится» или пишет, что
 * поправить. Своей таблицы нет — события таймлайна заказа (zernio_logs,
 * core/orders/events): `approval_sent` (ключ фото), `approval_ok`,
 * `approval_changes` (текст правок). Ответ принимается только на последнее
 * отправленное фото и один раз: повторное нажатие кнопки ничего не пишет.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listOrderEvents, recordOrderEvent, type OrderEvent } from "./events";

/** В каких статусах физического заказа фото на согласование имеет смысл. */
export const APPROVAL_STATUSES = ["accepted", "in_production", "ready"] as const;

export type ApprovalState =
  | { status: "none" }
  | { status: "waiting"; key: string; at: string }
  | { status: "ok"; key: string; at: string }
  | { status: "changes"; key: string; at: string; text: string };

export function approvalState(
  events: Array<Pick<OrderEvent, "kind" | "at" | "payload">>,
): ApprovalState {
  let s: ApprovalState = { status: "none" };
  for (const e of events) {
    if (e.kind === "approval_sent" && typeof e.payload.key === "string")
      s = { status: "waiting", key: e.payload.key, at: e.at };
    else if (s.status === "waiting" && e.kind === "approval_ok")
      s = { status: "ok", key: s.key, at: e.at };
    else if (s.status === "waiting" && e.kind === "approval_changes")
      s = {
        status: "changes",
        key: s.key,
        at: e.at,
        text: typeof e.payload.text === "string" ? e.payload.text : "",
      };
  }
  return s;
}

/**
 * Ответ покупателя на последнее фото: true — записан этим вызовом; false —
 * фото не ждёт ответа (уже ответили или не отправляли).
 */
export async function recordApprovalAnswer(
  ctx: TenantContext,
  orderId: number,
  answer: { ok: true } | { ok: false; text: string },
  actor = "customer",
): Promise<boolean> {
  const state = approvalState(await listOrderEvents(ctx, orderId));
  if (state.status !== "waiting") return false;
  if (answer.ok) await recordOrderEvent(ctx, orderId, "approval_ok", { key: state.key }, actor);
  else
    await recordOrderEvent(
      ctx,
      orderId,
      "approval_changes",
      { key: state.key, text: answer.text.trim().slice(0, 1000) },
      actor,
    );
  return true;
}

/** Слова согласия покупателя в Instagram/WhatsApp — всё остальное считаем правками. */
export function isApprovalYes(text: string): boolean {
  return /^(да|ок|ok|окей|хорошо|нравится|всё нравится|все нравится|отлично|супер|👍|✅|иә|ия|жарайды|yes|ha|xa|mayli)[\s!.)]*$/i.test(
    text.trim(),
  );
}
