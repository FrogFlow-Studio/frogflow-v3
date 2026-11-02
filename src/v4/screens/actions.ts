import { serverFailure } from "@/lib/server-failure";
import { closeCase } from "../core/cases/cases";
import type { V4Db } from "../core/db";
import { decideReceipt, orderMoney } from "../core/money/money";
import { CASE_CARDS, today, type CaseAction } from "./screens";

/**
 * Кнопки дел на «Сегодня (v4)». Работают только те действия, что меняют
 * данные v4 здесь же; остальные (ответить покупателю, способы оплаты,
 * открыть заказ…) появятся вместе со своими страницами v4, и до тех пор
 * панель их не показывает: текст не обещает больше кода (CLAUDE.md).
 *
 * «Один раз» обеспечивает SQL: close_case и decide_receipt — условные записи
 * (status = 'open' / 'waiting'), второй клик получает already.
 */

export const PANEL_ACTIONS = [
  "receipt_accept",
  "receipt_reject",
  "return_to_bot",
  "close_case",
] as const satisfies readonly CaseAction[];
export type PanelAction = (typeof PANEL_ACTIONS)[number];

export const isPanelAction = (a: CaseAction): a is PanelAction =>
  (PANEL_ACTIONS as readonly string[]).includes(a);

export type ActionOutcome =
  | { ok: true; becamePaid?: boolean }
  | {
      ok: false;
      code:
        | "case_not_found"
        | "not_allowed"
        | "already"
        | "reason_required"
        | "nothing_due"
        | "order_not_found";
    };

const NOTES: Record<"close_case" | "return_to_bot", string> = {
  close_case: "Закрыто продавцом в панели",
  return_to_bot: "Возвращено боту продавцом",
};

/** Выполнить действие по открытому делу магазина `botId`. */
export async function caseAction(
  db: V4Db,
  input: { botId: string; caseId: string; action: PanelAction; by: string; reason?: string },
): Promise<ActionOutcome> {
  const card = (await today(db, input.botId)).cards.find((c) => c.id === input.caseId);
  // Закрытое дело в «Сегодня» не попадает: второй клик по уже сделанному — already.
  if (!card) return { ok: false, code: "case_not_found" };
  const def = CASE_CARDS[card.kind];
  if (input.action !== def.primary && input.action !== def.secondary)
    return { ok: false, code: "not_allowed" };

  if (input.action === "close_case" || input.action === "return_to_bot") {
    const r = await closeCase(db, {
      botId: input.botId,
      caseId: card.id,
      note: NOTES[input.action],
      by: input.by,
    });
    if (!r.ok) throw serverFailure(`v4 caseAction: close_case отказ ${r.code}`);
    return r.value ? { ok: true } : { ok: false, code: "already" };
  }

  if (!card.receiptId || !card.orderId) return { ok: false, code: "not_allowed" };
  if (input.action === "receipt_reject") {
    const reason = input.reason?.trim();
    if (!reason) return { ok: false, code: "reason_required" };
    const r = await decideReceipt(db, {
      botId: input.botId,
      receiptId: card.receiptId,
      accept: false,
      reason,
      by: input.by,
    });
    if (!r.ok) throw serverFailure(`v4 caseAction: decide_receipt отказ ${r.code}`);
    return r.value.decided ? { ok: true } : { ok: false, code: "already" };
  }

  // «Деньги пришли»: принимаем ровно остаток к оплате. Сумму пишет книга
  // платежом с ключом receipt:<id> и событием в истории заказа (002-money).
  const money = await orderMoney(db, input.botId, card.orderId);
  if (!money) return { ok: false, code: "order_not_found" };
  const due = money.dueMinor;
  if (!(due > 0)) return { ok: false, code: "nothing_due" };
  const r = await decideReceipt(db, {
    botId: input.botId,
    receiptId: card.receiptId,
    accept: true,
    amountMinor: due,
    by: input.by,
  });
  if (!r.ok) throw serverFailure(`v4 caseAction: decide_receipt отказ ${r.code}`);
  return r.value.decided
    ? { ok: true, becamePaid: r.value.becamePaid }
    : { ok: false, code: "already" };
}

/** Есть ли магазин в v4. Под ролью арендатора — только свой (RLS, 010-panel.sql). */
export async function shopReady(db: V4Db, botId: string): Promise<boolean> {
  return Boolean((await db.call("shop_ready", { p_bot_id: botId }))[0]?.shop_ready);
}
