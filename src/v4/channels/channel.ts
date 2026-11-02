import type { SendOutcome } from "../core/cases/cases";

/**
 * Канал для ядра v4: адаптер только отправляет и честно говорит итог.
 * sent — дошло; failed — точно не дошло; unknown — обрыв, тайм-аут, 5xx:
 * могло дойти, ядро такое не повторяет (CLAUDE.md, «Внешние вызовы»).
 * Каждый вызов — со своим тайм-аутом через signal.
 */

export type CardButton = { kind: "buy"; productId: string; label: string };

export interface InstagramChannel {
  /** Публичный ответ под комментарием. */
  publicReply(
    postId: string,
    commentId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<SendOutcome>;
  /** Первое сообщение в Direct по комментарию (private reply), без кнопок. */
  privateReply(
    postId: string,
    commentId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<SendOutcome>;
  /** Сообщение в Direct с кнопками (карточка после «+»), в переписку покупателя. */
  sendCard(
    conversationId: string,
    text: string,
    buttons: CardButton[],
    signal: AbortSignal,
  ): Promise<SendOutcome>;
}
