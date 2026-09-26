import type { OutboxSender } from "@/core/outbox/outbox";
import { getSetting } from "@/core/settings/settings";
import { liveTransport, startWhatsAppConversation, type ZernioTransport } from "./api.server";
import { plain } from "./shop-flow";

const WINDOW_CLOSED = /24[- ]?(hour|час)|re-?engagement|131047|131026/i;

/** Настройка `whatsapp_bot_notify_template` — «имя:язык» одобренного шаблона с одним параметром. */
export function parseNotifyTemplate(raw: string | null | undefined): {
  name: string;
  language?: string;
} | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const [name, language] = v.split(/[:|]/).map((x) => x.trim());
  return name ? { name, language: language || undefined } : null;
}

/**
 * Исходящее в Instagram/WhatsApp из очереди — в тот же диалог Zernio. WhatsApp
 * вне 24-часового окна отказывает; тогда пишем первым по номеру: одобренным
 * шаблоном продавца (текст — параметр), а без шаблона — служебным Direct Send
 * (доступен не каждому аккаунту, поэтому это попытка, а не гарантия).
 */
export function zernioOutboxSender(
  transport: ZernioTransport = liveTransport,
  start: typeof startWhatsAppConversation = startWhatsAppConversation,
): OutboxSender {
  return async (ctx, msg) => {
    if (msg.target.channel !== "zernio") return { ok: false, error: "не Zernio" };
    const text = plain(msg.text ?? "");
    const r = await transport.send(msg.target.conversationId, msg.target.accountId, text, {
      platform: msg.target.platform,
    });
    if (r.ok) return { ok: true };
    const error = r.error ?? "zernio send failed";
    if (msg.target.platform !== "whatsapp" || !msg.target.phone || !WINDOW_CLOSED.test(error))
      return { ok: false, error };
    const tpl = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
    const first = await start(
      tpl
        ? {
            accountId: msg.target.accountId,
            phone: msg.target.phone,
            templateName: tpl.name,
            templateLanguage: tpl.language,
            templateParams: [text],
          }
        : { accountId: msg.target.accountId, phone: msg.target.phone, message: text },
    );
    return first.ok ? { ok: true } : { ok: false, error: `${error} ${first.error}` };
  };
}
