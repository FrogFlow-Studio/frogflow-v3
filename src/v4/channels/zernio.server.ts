import { zernioRequest, normalizeDmButtons, capButtonText } from "@/channels/zernio/api.server";
import { classifyZernioFailure, zernioFailureOf } from "@/channels/zernio/errors";
import type { SendOutcome } from "../core/cases/cases";
import type { InstagramChannel } from "./channel";

/**
 * Instagram через Zernio для ядра v4. Те же пути и поля, что у v3
 * (automations.server.ts: private-reply, публичный ответ по commentId;
 * api.server.ts: сообщение в переписку с кнопками). Ошибки разбирает только
 * src/channels/zernio/errors.ts (CLAUDE.md): «ambiguous» (500, тайм-аут,
 * нет ответа) — unknown, такое ядро не повторяет; остальное — failed.
 */

type Request = typeof zernioRequest;

const PER_CALL_MS = 10_000;

export function outcomeOf(e: unknown): SendOutcome {
  return classifyZernioFailure(zernioFailureOf(e)) === "ambiguous" ? "unknown" : "failed";
}

export function zernioInstagram(
  accountId: string,
  request: Request = zernioRequest,
): InstagramChannel {
  const send = async (endpoint: string, body: Record<string, unknown>, key: string) => {
    try {
      // Ключ идемпотентности: повтор того же запроса Zernio не отправит второй раз.
      await request(endpoint, {
        method: "POST",
        body,
        idempotencyKey: key,
        timeoutMs: PER_CALL_MS,
      });
      return "sent" as const;
    } catch (e) {
      return outcomeOf(e);
    }
  };
  return {
    publicReply: (postId, commentId, text) =>
      // Тот же путь без commentId публикует НОВЫЙ комментарий — commentId обязателен.
      send(
        `/inbox/comments/${encodeURIComponent(postId)}`,
        { accountId, message: text, commentId },
        `v4-public:${postId}:${commentId}`,
      ),
    privateReply: (postId, commentId, text) =>
      // Первое сообщение — без кнопок: поле buttons не передаём совсем.
      send(
        `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/private-reply`,
        { accountId, message: text },
        `v4-private:${postId}:${commentId}`,
      ),
    sendCard: (conversationId, text, buttons) =>
      send(
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          accountId,
          message: capButtonText(text),
          buttons: normalizeDmButtons(
            buttons.map((b) => ({
              type: "postback",
              title: b.label,
              payload: `v4buy:${b.productId}`,
            })),
          ),
        },
        `v4-card:${conversationId}:${buttons.map((b) => b.productId).join(",")}`,
      ),
  };
}
