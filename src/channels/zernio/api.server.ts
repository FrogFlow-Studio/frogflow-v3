import { env } from "@/config/env";
import type { Json } from "@/core/db-types";
import { normalizeZernioBaseUrl } from "./base-url";
import { idempotencyKeyFor } from "./event-context.server";
import { normalizeInboxMessage, type ZernioInboxMessage } from "./inbox-types";
import type { ZernioPlatform } from "./platform";
import {
  ZERNIO_WEBHOOK_EVENTS,
  ZERNIO_WEBHOOK_NAME,
  findStoreWebhook,
  type ZernioWebhookRecord,
} from "./webhook-fit";

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

/* ── профили, аккаунты, вебхук ───────────────────────────────────────── */

export type ZernioProfile = { _id: string; name: string; description?: string };

export type ZernioAccount = {
  _id: string;
  platform: string;
  name?: string;
  username?: string;
  /** Ссылка на профиль — строкой или развёрнутым объектом, зависит от эндпоинта. */
  profileId?: string | { _id: string };
  isExpired?: boolean;
};

export function accountProfileId(a: ZernioAccount): string | null {
  return typeof a.profileId === "string" ? a.profileId : (a.profileId?._id ?? null);
}

export async function listProfiles(): Promise<ZernioProfile[]> {
  const r = await request<{ profiles?: ZernioProfile[] }>("/profiles");
  return r.profiles ?? [];
}

/** Профиль Zernio — «папка» аккаунтов одного клиента; по нему разводятся вебхуки и подключения. */
export async function createProfile(name: string, description?: string): Promise<ZernioProfile> {
  const r = await request<{ profile: ZernioProfile }>("/profiles", {
    method: "POST",
    body: { name, description: description ?? "FrogFlow" },
  });
  return r.profile;
}

/** Ссылка OAuth-подключения аккаунта в профиль; после авторизации Zernio вернёт на redirectUrl. */
export async function connectUrl(
  platform: ZernioPlatform,
  profileId: string,
  redirectUrl?: string,
): Promise<string> {
  const query: Record<string, string> = { profileId };
  if (redirectUrl) query.redirect_url = redirectUrl;
  const r = await request<{ authUrl: string }>(`/connect/${platform}`, { query });
  return r.authUrl;
}

export async function listAccounts(profileId?: string): Promise<ZernioAccount[]> {
  const r = await request<{ accounts?: ZernioAccount[] }>("/accounts", {
    query: profileId ? { profileId } : undefined,
  });
  return r.accounts ?? [];
}

export async function readWebhookSettings(): Promise<ZernioWebhookRecord[]> {
  const r = await request<{ webhooks?: ZernioWebhookRecord[] }>("/webhooks/settings");
  return r.webhooks ?? [];
}

/**
 * Записать store-webhook на этот деплой: существующую запись (в том числе
 * под старым именем) обновляем, а не заводим вторую — иначе каждое событие
 * приходило бы дважды.
 */
export async function upsertWebhook(url: string): Promise<{ ok: boolean; error?: string }> {
  const secret = env().ZERNIO_WEBHOOK_SECRET?.trim();
  if (!secret) return { ok: false, error: "ZERNIO_WEBHOOK_SECRET не задан" };
  try {
    const existing = findStoreWebhook(await readWebhookSettings(), url);
    const r = await request<{ success?: boolean; error?: string }>("/webhooks/settings", {
      method: existing ? "PUT" : "POST",
      body: {
        ...(existing ? { _id: existing._id || existing.id } : {}),
        name: ZERNIO_WEBHOOK_NAME,
        url,
        secret,
        events: [...ZERNIO_WEBHOOK_EVENTS],
        isActive: true,
      },
    });
    if (r.success === false)
      return { ok: false, error: r.error || "Zernio не принял настройки вебхука" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ── WhatsApp: шаблоны Meta и первое сообщение ───────────────────────── */

/** Вердикт ревью Meta по шаблону; значения приходят дословно, отправить можно только APPROVED. */
export type WhatsAppTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  /** Форма компонентов задаётся Meta и уходит к ней же без изменений. */
  components?: Json;
  /** Причина отказа от Meta; при одобрении приходит "NONE". */
  reason?: string;
};

export async function listWhatsAppTemplates(accountId: string): Promise<WhatsAppTemplate[]> {
  const result = await request<{ templates?: WhatsAppTemplate[] }>("/whatsapp/templates", {
    query: { accountId },
  });
  return result.templates ?? [];
}

export async function createWhatsAppTemplate(input: {
  accountId: string;
  name: string;
  /** MARKETING допустим, но тарифицируется дороже; для магазина почти всегда UTILITY. */
  category: "UTILITY" | "MARKETING";
  language: string;
  components: Json;
}): Promise<{ ok: true; template?: WhatsAppTemplate } | { ok: false; error: string }> {
  try {
    const result = await request<{ template?: WhatsAppTemplate }>("/whatsapp/templates", {
      method: "POST",
      body: input,
    });
    return { ok: true, template: result.template };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Написать в WhatsApp первым — единственный способ начать разговор или
 * вернуться в него после закрытия 24-часового окна. Meta пропускает либо
 * одобренный шаблон (работает всегда, но стоит денег за доставку), либо
 * служебное сообщение категории utility без шаблона (Direct Send — доступен
 * не каждому WABA, поэтому это попытка, а не гарантия).
 */
export async function startWhatsAppConversation(params: {
  accountId: string;
  /** Телефон получателя в международном формате, только цифры. */
  phone: string;
  message?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}): Promise<{ ok: true; conversationId?: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    accountId: params.accountId,
    participantId: params.phone.replace(/\D/g, ""),
  };
  if (params.templateName) {
    body.templateName = params.templateName;
    if (params.templateLanguage) body.templateLanguage = params.templateLanguage;
    if (params.templateParams?.length) body.templateParams = params.templateParams;
    if (params.message) body.message = params.message;
  } else {
    // Direct Send: category и templateName взаимоисключающи, message обязателен.
    body.category = "utility";
    body.message = params.message ?? "";
  }
  try {
    const result = await request<{
      data?: { conversationId?: string; id?: string };
      conversationId?: string;
      conversation?: { id?: string };
    }>("/inbox/conversations", { method: "POST", body, idempotencyKey: idempotencyKeyFor(body) });
    return {
      ok: true,
      conversationId:
        result.data?.conversationId ||
        result.data?.id ||
        result.conversationId ||
        result.conversation?.id ||
        undefined,
    };
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    console.error(`[zernio] startWhatsAppConversation failed: ${details}`);
    if (/TEMPLATE_REQUIRED/i.test(details))
      return {
        ok: false,
        error:
          "WhatsApp требует одобренный шаблон, чтобы написать первым. Создайте шаблон в разделе «Рассылки» и дождитесь одобрения Meta.",
      };
    if (/Direct Send/i.test(details))
      return {
        ok: false,
        error:
          "Этот WhatsApp-аккаунт не допущен к отправке без шаблона. Нужен одобренный шаблон Meta.",
      };
    return { ok: false, error: details };
  }
}

/** Транспорт канала — подменяется в тестах, чтобы не ходить в Zernio. */
export type ZernioTransport = {
  send: typeof sendInboxMessage;
  tail: typeof listConversationMessages;
  /** Скачивание вложения (чек) — в тестах подменяется, по умолчанию fetch по ссылке Zernio. */
  download?: (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
};

export const liveTransport: ZernioTransport = {
  send: sendInboxMessage,
  tail: listConversationMessages,
};
