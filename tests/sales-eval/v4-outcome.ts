import { BUY_BUTTON_TITLE } from "@/channels/zernio/shop/buy-button";
import type { TurnOutcome } from "./checks";

/**
 * Ход ИИ-продавца v4 → исход для мерила продаж. Кнопки v4 подписаны
 * «Купить: <товар>», а мерило узнаёт кнопку по заголовку v3 «🛒 Купить»:
 * каждая показанная кнопка становится этим заголовком. В прогоне 05.11
 * исход собирался без кнопок, и флаг «нет кнопки» стоял в 9 ходах из 9,
 * где кнопка была (reports/v4-audit, «Прогон 4.1»). Тест: v4-outcome.test.ts.
 */
export type V4TurnReply =
  | { kind: "silent"; reason: string }
  | {
      kind: "reply";
      text: string;
      buttons: ReadonlyArray<unknown>;
      actions: ReadonlyArray<{ kind: string }>;
    };

export function v4TurnOutcome(r: V4TurnReply, newOrders = 0): TurnOutcome {
  if (r.kind === "silent") {
    return { replies: [], buttons: [], newOrders, handedOff: r.reason === "handoff" };
  }
  return {
    replies: r.text ? [r.text] : [],
    buttons: r.buttons.map(() => BUY_BUTTON_TITLE.ru),
    newOrders,
    handedOff: r.actions.some((a) => a.kind === "handoff"),
  };
}
