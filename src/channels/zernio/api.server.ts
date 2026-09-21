import { env } from "@/config/env";
import { normalizeZernioBaseUrl } from "./base-url";
import { idempotencyKeyFor } from "./event-context.server";
import { normalizeInboxMessage, type ZernioInboxMessage } from "./inbox-types";
import type { ZernioPlatform } from "./platform";

/**
 * Клиент API Zernio. Ключ один на платформу (env), аккаунты клиентов — в
 * bots.settings.zernio. Здесь только то, что нужно каналу сейчас: отправить
 * сообщение и прочитать хвост переписки; подключение аккаунтов, посты и
 * шаблоны WhatsApp — по мере переноса (docs/ROADMAP.md, фаза 4).
 */
export function zernioConfigured(): boolean {
  return Boolean(env().ZERNIO_API_KEY?.trim());
}

async function request<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string>;
    /** Zernio хранит ключ сутки: тот же ключ с тем же телом возвращает исходный ответ. */
    idempotencyKey?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const apiKey = env().ZERNIO_API_KEY?.trim();
  if (!apiKey) throw new Error("ZERNIO_API_KEY не задан");
  let url = `${normalizeZernioBaseUrl(env().ZERNIO_BASE_URL)}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  if (options.query) url += `?${new URLSearchParams(options.query).toString()}`;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = /^\s*</.test(text)
      ? "Zernio вернул HTML-страницу вместо ответа API"
      : text.slice(0, 1000);
    throw new Error(`Zernio API ${response.status}: ${detail}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Zernio вернул не JSON (${response.headers.get("content-type") || "без content-type"}). Проверьте ZERNIO_BASE_URL.`,
    );
  }
}

export type DmButton = { type: "url" | "postback"; title: string; url?: string; payload?: string };

/**
 * Кнопки в строгом формате Meta/Zernio: с URL — тип url без payload, без
 * URL — postback с непустым payload; не больше трёх (ограничение Direct).
 */
export function normalizeDmButtons(buttons?: DmButton[]): DmButton[] {
  if (!Array.isArray(buttons)) return [];
  return buttons
    .filter((b) => b && typeof b.title === "string" && b.title.trim())
    .map((b) => {
      const title = b.title.trim();
      const url = typeof b.url === "string" ? b.url.trim() : "";
      if (/^https?:\/\//i.test(url)) return { type: "url" as const, title, url };
      return { type: "postback" as const, title, payload: b.payload?.trim() || "/start" };
    })
    .slice(0, 3);
}

export type SendOptions = {
  platform?: ZernioPlatform;
  buttons?: DmButton[];
  attachmentUrl?: string;
  attachmentType?: "image" | "video" | "audio" | "file";
  /** WhatsApp показывает имя документа получателю; без него — «Untitled». */
  attachmentName?: string;
};

export type SendResult = { ok: boolean; error?: string };

/** Ошибка отправки словами продавца: у WhatsApp вне 24-часового окна свой, штатный отказ. */
export function describeSendError(platform: ZernioPlatform, details: string): string {
  if (platform === "whatsapp" && /re-?engagement|131047|131026|24[- ]hour/i.test(details)) {
    return "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном.";
  }
  const channel = platform === "whatsapp" ? "WhatsApp" : "Instagram";
  if (/inbox add-on required/i.test(details))
    return `Для этого аккаунта недоступна отправка сообщений (${channel}). Проверьте права подключения и тариф сервиса.`;
  return `Не удалось отправить сообщение. Проверьте подключение ${channel} и повторите попытку.`;
}

export async function sendInboxMessage(
  conversationId: string,
  accountId: string,
  text: string,
  opts: SendOptions = {},
): Promise<SendResult> {
  const platform = opts.platform ?? "instagram";
  if (!zernioConfigured())
    return {
      ok: false,
      error: "Zernio не подключён на платформе (ZERNIO_API_KEY) — обратитесь к оператору.",
    };
  const body: Record<string, unknown> = { accountId, message: text };
  if (opts.attachmentUrl) {
    body.attachmentUrl = opts.attachmentUrl;
    body.attachmentType = opts.attachmentType ?? "image";
    if (opts.attachmentName) body.attachmentName = opts.attachmentName;
  }
  const buttons = normalizeDmButtons(opts.buttons);
  if (buttons.length) body.buttons = buttons;
  try {
    await request(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body,
      // Повтор доставки вебхука не должен обернуться вторым сообщением у покупателя.
      idempotencyKey: idempotencyKeyFor(body),
    });
    return { ok: true };
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    console.error(`[zernio] send failed for ${conversationId}: ${details}`);
    return { ok: false, error: describeSendError(platform, details) };
  }
}

/**
 * Последние сто сообщений переписки в хронологическом порядке. Просим
 * новейшие (sortOrder=desc) — v1 просил первые сто и в длинном диалоге
 * смотрел в прошлую неделю (fix 9e5d271); порядок восстанавливаем сами.
 */
export async function listConversationMessages(
  accountId: string,
  conversationId: string,
): Promise<ZernioInboxMessage[]> {
  const result = await request<{ messages?: ZernioInboxMessage[] }>(
    `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
    { query: { accountId, limit: "100", sortOrder: "desc" } },
  );
  return (result.messages ?? [])
    .map(normalizeInboxMessage)
    .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
}

/** Транспорт канала — подменяется в тестах, чтобы не ходить в Zernio. */
export type ZernioTransport = {
  send: typeof sendInboxMessage;
  tail: typeof listConversationMessages;
};

export const liveTransport: ZernioTransport = {
  send: sendInboxMessage,
  tail: listConversationMessages,
};
