import type { OutboxFailure, OutboxSender } from "@/core/outbox/outbox";
import { getSetting } from "@/core/settings/settings";
import { liveTransport, startWhatsAppConversation, type ZernioTransport } from "./api.server";
import { classifyZernioFailure, rateLimitedRecipient, type ZernioFailure } from "./errors";
import type { ZernioInboxMessage } from "./inbox-types";
import { plain } from "./shop-flow";

/** Дошло ли сообщение, по хвосту переписки: пустой ответ — «неизвестно», а не «не дошло». */
export type Reconciled = "found" | "absent" | "unknown";

/**
 * Что делать очереди с отказом Zernio — по коду ответа, не по тексту.
 * 500 и таймаут неоднозначны (Zernio мог отправить): повтор только если
 * сверка переписки показала, что нашего сообщения там нет; не удалось
 * сверить — не повторяем и пишем продавцу «возможно доставлено».
 */
export async function outboxFailure(
  error: string,
  failure: ZernioFailure | undefined,
  reconcile: () => Promise<Reconciled> = async () => "unknown",
): Promise<{ ok: true } | ({ ok: false } & OutboxFailure)> {
  switch (classifyZernioFailure(failure)) {
    case "rate_limited":
      return {
        ok: false,
        error,
        retryAfterSec: failure?.retryAfterSec ?? 60,
        ...(rateLimitedRecipient(failure) ? { recipientOnly: true } : {}),
      };
    case "temporary":
      return { ok: false, error };
    case "ambiguous": {
      const seen = await reconcile().catch((): Reconciled => "unknown");
      if (seen === "found") return { ok: true };
      if (seen === "absent") return { ok: false, error };
      return {
        ok: false,
        error: `Возможно доставлено, проверьте переписку: ${error}`,
        permanent: true,
      };
    }
    default:
      // Окно закрыто без шаблона, получатель недостижим, отказ по правам:
      // пять повторов за три часа ответа не изменят.
      return { ok: false, error, permanent: true };
  }
}

/** Наше сообщение среди исходящих хвоста переписки (текст без разметки, после начала попытки). */
export function findSent(tail: ZernioInboxMessage[], text: string, since: Date): Reconciled {
  if (tail.length === 0) return "unknown";
  const want = text.trim();
  const hit = tail.some(
    (m) =>
      m.direction !== "incoming" &&
      (m.message ?? "").trim() === want &&
      !(Date.parse(m.createdAt ?? "") < since.getTime() - 60_000),
  );
  return hit ? "found" : "absent";
}

/**
 * Текст в параметр шаблона WhatsApp. В документации Zernio ограничений на
 * параметр нет, но их ставит Meta (ошибка 132018): без переносов строк и
 * табуляций, не больше четырёх пробелов подряд; всё тело шаблона — до 1024
 * символов, поэтому параметр режем с запасом на текст самого шаблона.
 */
export const TEMPLATE_PARAM_MAX = 900;

export function templateParam(text: string): string {
  const one = text
    .replace(/\s*[\r\n]+\s*/g, " · ")
    .replace(/\t/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
  const chars = [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(one)].map(
    (x) => x.segment,
  );
  return chars.length <= TEMPLATE_PARAM_MAX
    ? one
    : `${chars
        .slice(0, TEMPLATE_PARAM_MAX - 1)
        .join("")
        .trimEnd()}…`;
}

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
    const target = msg.target;
    if (target.channel !== "zernio") return { ok: false, error: "не Zernio" };
    const text = plain(msg.text ?? "");
    // Ключ идемпотентности один на сообщение очереди, а не на попытку: если
    // прошлая попытка дошла, а ответ потерялся (таймаут), Zernio вернёт её
    // ответ, а не отправит второй раз; отказы Zernio не запоминает.
    const idempotencyScope = msg.eventId;
    const startedAt = new Date();
    const r = await transport.send(target.conversationId, target.accountId, text, {
      platform: target.platform,
      idempotencyScope,
    });
    if (r.ok) return { ok: true };
    const error = r.error ?? "zernio send failed";
    if (
      target.platform !== "whatsapp" ||
      !target.phone ||
      classifyZernioFailure(r.failure) !== "window_closed"
    )
      return outboxFailure(error, r.failure, async () =>
        findSent(await transport.tail(target.accountId, target.conversationId), text, startedAt),
      );
    const tpl = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
    const first = await start(
      tpl
        ? {
            accountId: target.accountId,
            phone: target.phone,
            templateName: tpl.name,
            templateLanguage: tpl.language,
            templateParams: [templateParam(text)],
            idempotencyScope,
          }
        : {
            accountId: target.accountId,
            phone: target.phone,
            message: text,
            idempotencyScope,
          },
    );
    // Первое сообщение по номеру открывает другой диалог — сверять не с чем.
    return first.ok ? { ok: true } : outboxFailure(`${error} ${first.error}`, first.failure);
  };
}
