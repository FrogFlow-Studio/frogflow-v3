import { rejectedForSure, type TelegramApi, type TgResult } from "@/channels/telegram/api";
import { sendInboxMessage, type SendResult } from "@/channels/zernio/api.server";
import { classifyZernioFailure } from "@/channels/zernio/errors";
import type { SendOutcome } from "../core/cases/cases";
import type { BuyerSender } from "../jobs/deliver";
import type { NotifyTarget } from "../jobs/notify";
import type { ZernioAccountSnapshot } from "@/core/tenant/types";
import type { SellerLang } from "../screens/screens";

/**
 * Настоящие отправители v4 поверх клиентов v3 (Telegram Bot API, Zernio).
 * Итог — одно из трёх: sent; failed — канал ответил и точно не принял;
 * unknown — обрыв, тайм-аут, 5xx: могло дойти, поэтому не повторяем и не
 * дублируем другим способом (CLAUDE.md). Ошибки Zernio разбирает только
 * src/channels/zernio/errors.ts.
 */

export function telegramOutcome(r: TgResult): SendOutcome {
  if (r.ok) return "sent";
  return rejectedForSure(r) ? "failed" : "unknown";
}

export function zernioOutcome(r: SendResult): SendOutcome {
  if (r.ok) return "sent";
  // Без failure — до запроса не дошло (Zernio не подключён): точно не ушло.
  if (!r.failure) return "failed";
  return classifyZernioFailure(r.failure) === "ambiguous" ? "unknown" : "failed";
}

type SendInbox = typeof sendInboxMessage;

/**
 * Отправитель покупателю: Telegram — ботом магазина, Instagram и WhatsApp —
 * через Zernio, с того аккаунта магазина, куда покупатель писал; если он не
 * записан — с единственного аккаунта магазина на этой площадке.
 */
export function v4BuyerSender(deps: {
  telegram: TelegramApi | null;
  /** Единственный аккаунт магазина на площадке; null — нет или их несколько. */
  zernioAccount: { instagram?: string | null; whatsapp?: string | null };
  sendInbox?: SendInbox;
}): BuyerSender {
  const sendInbox = deps.sendInbox ?? sendInboxMessage;
  return async (channel, to, text) => {
    if (channel === "telegram") {
      if (!deps.telegram) return "failed";
      return telegramOutcome(
        await deps.telegram.call("sendMessage", {
          chat_id: to.externalId,
          text,
          link_preview_options: { is_disabled: true },
        }),
      );
    }
    const account = to.accountId ?? deps.zernioAccount[channel];
    // Без аккаунта или переписки писать некуда — это «не отправлено», не «могло дойти».
    if (!account || !to.conversationId) return "failed";
    return zernioOutcome(
      await sendInbox(to.conversationId, account, text, {
        platform: channel,
        idempotencyScope: "v4",
      }),
    );
  };
}

/** Единственный действующий аккаунт магазина на площадке (снимок settings.zernio). */
export function soleZernioAccount(
  zernio: { account_ids?: string[]; accounts?: ZernioAccountSnapshot[] } | undefined,
  platform: "instagram" | "whatsapp",
): string | null {
  const own = new Set(zernio?.account_ids ?? []);
  const ids = (zernio?.accounts ?? [])
    .filter((a) => a.platform === platform && !a.expired && own.has(a.id))
    .map((a) => a.id);
  return ids.length === 1 ? ids[0]! : null;
}

/**
 * Адресат уведомлений продавца в Telegram: каждому из чатов магазина
 * (admin_chat_id и владелец, core/notify/recipients) по сообщению. Дошло
 * хоть одному — sent; всем точно отказано — failed; иначе — unknown.
 */
export function v4SellerTarget(deps: {
  telegram: TelegramApi | null;
  chatIds: readonly string[];
  lang: SellerLang;
}): NotifyTarget | null {
  const ids = [...new Set(deps.chatIds)].filter(Boolean);
  const telegram = deps.telegram;
  if (!telegram || !ids.length) return null;
  return {
    lang: deps.lang,
    send: async (text) => {
      const outcomes: SendOutcome[] = [];
      for (const id of ids)
        outcomes.push(
          telegramOutcome(
            await telegram.call("sendMessage", {
              chat_id: id,
              text,
              link_preview_options: { is_disabled: true },
            }),
          ),
        );
      if (outcomes.includes("sent")) return "sent";
      return outcomes.every((o) => o === "failed") ? "failed" : "unknown";
    },
  };
}
