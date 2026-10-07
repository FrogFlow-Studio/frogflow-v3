import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimStateSection, updateStateSection, type Customer } from "@/core/customers/customers";
import { buyerLocale } from "@/core/consultant/messages";
import { makeReason } from "@/core/chat/reason";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { isStickerOnly, nonTextKind, NON_TEXT_WINDOW_MS, VOICE_WRITE_TEXT } from "./nontext";

/**
 * Что консультант в Direct/WhatsApp разбирает до модели (перенос v1 BOVI,
 * consultant/handle-message.ts:395-433):
 * - стикер или гифка-реакция — молчим;
 * - голосовое — «напишите текстом», не чаще раза в 10 минут;
 * - публикация (рилс, пост, сторис) без слов — запоминаем на три минуты и
 *   отдаём консультанту со следующим вопросом. Живой случай v1 22.09: рилс
 *   пришёл отдельным сообщением, «Сколько стоит?» — следующим, и бот
 *   переспросил, какой товар, хотя покупатель только что показал.
 * Состояние — в bot_users.state.consultant, точечно поверх свежего
 * (updateStateSection/claimStateSection): его пишут и бот, и v1.
 */

/** Сколько живёт запомненная публикация: секунды на вопрос с запасом, но не час. */
export const PENDING_STORY_MS = 3 * 60_000;

export type PendingStory = { id: string | null; url: string | null; at: string };
export type ConsultantStory = { storyId: string | null; mediaUrl: string | null };

function pendingOf(customer: Customer): PendingStory | null {
  const c = customer.state.consultant as { pending_story?: unknown } | undefined;
  const p = c?.pending_story as Partial<PendingStory> | undefined;
  if (!p || typeof p !== "object" || typeof p.at !== "string") return null;
  return { id: p.id ?? null, url: p.url ?? null, at: p.at };
}

/** Только стикер или гифка из стикеров, без текста — консультанту отвечать не на что. */
export function consultantIgnoresSticker(m: ParsedZernioMessage): boolean {
  return !m.text.trim() && !m.postbackPayload && isStickerOnly(m.attachments);
}

export type BeforeConsultant =
  | { done: true; note: string; customer: Customer }
  | { done: false; customer: Customer; story: ConsultantStory };

export async function beforeConsultant(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedZernioMessage,
  transport: ZernioTransport,
  opts: { customerPhotos: number; now?: number },
): Promise<BeforeConsultant> {
  const now = opts.now ?? Date.now();
  const bare = !m.text.trim() && !m.postbackPayload;

  if (bare && nonTextKind(m.attachments) === "voice") {
    // Отметка — условной записью до отправки: из двух голосовых подряд просьба уходит одна.
    const claimed = await claimStateSection(ctx, customer, "consultant", (cur) => {
      const at = Date.parse(String(cur.voice_asked_at ?? ""));
      if (Number.isFinite(at) && now - at < NON_TEXT_WINDOW_MS) return null;
      return { ...cur, voice_asked_at: new Date(now).toISOString() };
    });
    if (!claimed) return { done: true, note: "голосовое — просьба писать уже ушла", customer };
    const text = VOICE_WRITE_TEXT[buyerLocale(ctx, claimed)];
    const r = await transport.send(m.conversationId!, m.accountId!, text, { platform: m.platform });
    if (r.ok && ctx.tenant.modules.manager_chat) {
      const { recordMessage } = await import("@/core/chat/chat");
      await recordMessage(ctx, {
        telegramId: claimed.telegramId,
        direction: "out",
        sender: "bot",
        text,
        reason: makeReason({ source: "consultant", rule: "voice" }),
      }).catch(() => {});
    }
    return { done: true, note: "голосовое — попросили написать текстом", customer: claimed };
  }

  const own: ConsultantStory = { storyId: m.storyId, mediaUrl: m.storyMediaUrl };
  const hasOwn = Boolean(own.storyId || own.mediaUrl);
  // Публикация без слов и без своих фото — отвечать нечего, но запомнить нужно.
  if (hasOwn && bare && opts.customerPhotos === 0) {
    const saved = await updateStateSection(ctx, customer, "consultant", (cur) => ({
      ...cur,
      pending_story: { id: own.storyId, url: own.mediaUrl, at: new Date(now).toISOString() },
    }));
    return { done: true, note: "публикация запомнена до вопроса", customer: saved };
  }
  if (hasOwn) return { done: false, customer, story: own };

  const pending = pendingOf(customer);
  if (!pending) return { done: false, customer, story: own };
  const at = Date.parse(pending.at);
  const fresh = Number.isFinite(at) && now - at < PENDING_STORY_MS;
  // Публикация отдана вопросу (или устарела) — убираем, чтобы не прилипла к следующему.
  const cleared = await updateStateSection(ctx, customer, "consultant", (cur) => {
    const { pending_story: _p, ...rest } = cur;
    return rest;
  });
  return {
    done: false,
    customer: cleared,
    story: fresh ? { storyId: pending.id, mediaUrl: pending.url } : own,
  };
}
