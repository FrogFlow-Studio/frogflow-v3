import { chatInvoiceModesFn } from "@/app/admin/chat.functions";
import { isAdminKey, type AdminT } from "@/app/i18n/admin";
import { Badge } from "@/app/ui";
import type { ChatMessage, Conversation } from "@/core/chat/chat";
import { mergeMessages } from "@/core/chat/merge-messages";
import { reasonPairs } from "@/core/chat/reason";
import { serverClockOffset, windowLeftParts, type ReplyWindow } from "@/core/chat/reply-window";

/** «Почему бот так ответил»: раскрывающаяся строка под ответом бота; без записанной причины её нет. */
export function WhyBot({ reason, t }: { reason: string | null | undefined; t: AdminT }) {
  const pairs = reasonPairs(reason);
  if (pairs.length === 0) return null;
  return (
    <details className="mt-1 text-xs text-muted">
      <summary className="cursor-pointer select-none">{t("chatReason.title")}</summary>
      <ul className="mt-1 space-y-0.5">
        {pairs.map((p) => {
          const label: string = `chatReason.${p.key}`;
          return (
            <li key={p.key}>
              {t(isAdminKey(label) ? label : "chatReason.other")}:{" "}
              <span className="font-mono">{p.value === "1" ? "✓" : p.value}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export const POLL_MS = 5000;

/** Фото уходит картинкой, всё прочее — документом (правила — core/storage/upload). */
export const PHOTO_TYPES = ["image/jpeg", "image/png"];

export const ATTACH_ACCEPT = "image/jpeg,image/png,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";

export type ChatAttachment = { kind: "photo" | "file"; key: string; name: string };

export function label(c: Conversation): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return name || (c.username ? `@${c.username}` : c.user_key || `id ${c.telegram_id}`);
}

export const CHANNEL: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

/** Окно 24 часа Instagram/WhatsApp: сколько осталось или что закрыто. */
/** Переписка с ответа сервера; смещение часов фиксируется в момент ответа. */
export function threadOf(
  prev: Thread,
  telegramId: number,
  r: {
    messages: ChatMessage[];
    hasMore: boolean;
    lastInboundAt: string | null;
    serverNow: string;
    waTemplate: string | null;
  },
): Thread {
  // Тот же диалог: уже подгруженную раньше переписку опрос не стирает.
  const same = prev.telegramId === telegramId;
  return {
    telegramId,
    messages: same ? mergeMessages(prev.messages, r.messages) : r.messages,
    hasMore: same ? prev.hasMore : r.hasMore,
    lastInboundAt: r.lastInboundAt,
    waTemplate: r.waTemplate,
    clockOffset: serverClockOffset(r.serverNow, Date.now()),
  };
}

export type Thread = {
  telegramId: number | null;
  messages: ChatMessage[];
  /** Есть ли переписка раньше первого показанного сообщения. */
  hasMore: boolean;
  lastInboundAt: string | null;
  /** Имя шаблона WhatsApp для ответа вне окна; null — не задан. */
  waTemplate: string | null;
  /** Разница часов сервера и браузера на момент ответа сервера. */
  clockOffset: number;
};

export function WindowBadge({ t, w }: { t: AdminT; w: ReplyWindow }) {
  if (w.state === "closed")
    return (
      <span className="mt-0.5 block">
        <Badge tone="warn">{t("chat.windowClosed")}</Badge>
      </span>
    );
  const { h, m } = windowLeftParts(w.leftMs);
  return (
    <span className="mt-0.5 block">
      <Badge tone={w.leftMs < 2 * 3_600_000 ? "warn" : "ok"}>
        {t("chat.windowOpen", { h, m })}
      </Badge>
    </span>
  );
}

export function channelOf(c: Conversation): string | null {
  return CHANNEL[c.platform] ?? null;
}

type InvoiceModes = Awaited<ReturnType<typeof chatInvoiceModesFn>>;

/** Режим счёта для диалога; пока режимы не загрузились — как раньше, кнопкой. */
export function invoiceModeOf(modes: InvoiceModes | null, c: Conversation): string {
  if (!modes) return "channel";
  if (c.platform === "instagram") return modes.instagram;
  if (c.platform === "whatsapp") return modes.whatsapp;
  return modes.telegram;
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

export const BUBBLE: Record<string, string> = {
  customer: "self-start bg-surface-2",
  manager: "self-end bg-accent/15",
  bot: "self-end border border-line bg-surface",
};
