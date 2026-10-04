import { env } from "@/config/env";
import { beforeExternalEffect } from "@/lib/external-effects";
import { PREVIEW_SEND_OFF, previewReadonly } from "@/lib/preview";
import type { Json } from "@/core/db-types";
import { readCapped } from "@/lib/read-capped";
import { attachmentNeedsZernioKey, normalizeZernioBaseUrl, withReceivingAccount } from "./base-url";
import { idempotencyKeyFor } from "./event-context.server";
import {
  CONNECT_FAILED,
  ZernioApiError,
  classifyZernioFailure,
  connectFailed,
  parseZernioFailure,
  zernioFailureOf,
  type ZernioFailure,
} from "./errors";
import { normalizeInboxMessage, type ZernioInboxMessage } from "./inbox-types";
import type { ZernioPlatform } from "./platform";
import type { V2WebhookPlan, ZernioWebhookRecord } from "./webhook-fit";

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
  if ((options.method ?? "GET") !== "GET") {
    if (previewReadonly()) throw new ZernioApiError(PREVIEW_SEND_OFF, { status: null });
    await beforeExternalEffect();
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
    });
  } catch (e) {
    throw new ZernioApiError(
      `Zernio API: нет ответа (${e instanceof Error ? e.message : String(e)})`,
      { status: null, ...(connectFailed(e) ? { code: CONNECT_FAILED } : {}) },
    );
  }
  const text = await response.text();
  if (!response.ok) {
    const detail = /^\s*</.test(text)
      ? "Zernio вернул HTML-страницу вместо ответа API"
      : text.slice(0, 1000);
    throw new ZernioApiError(
      `Zernio API ${response.status}: ${detail}`,
      parseZernioFailure(response.status, text, response.headers.get("retry-after")),
    );
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

/** Zernio принимает заголовок кнопки не длиннее 20 символов, иначе 400 на всё сообщение. */
export const DM_BUTTON_TITLE_MAX = 20;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Заголовок кнопки в пределах лимита с «…» на конце. Лимит считается в
 * единицах UTF-16 (`.length`, как у Meta), а режем по графемам: составной
 * эмодзи (семья, флаг, тон кожи) либо входит целиком, либо не входит.
 */
export function buttonTitle(title: string): string {
  const t = title.trim();
  if (t.length <= DM_BUTTON_TITLE_MAX) return t;
  let out = "";
  for (const { segment } of graphemes.segment(t)) {
    if (out.length + segment.length > DM_BUTTON_TITLE_MAX - 1) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Кнопки в строгом формате Meta/Zernio: с URL — тип url без payload, без
 * URL — postback с непустым payload; не больше трёх (ограничение Direct),
 * заголовок не длиннее 20 символов.
 */
export function normalizeDmButtons(buttons?: DmButton[]): DmButton[] {
  if (!Array.isArray(buttons)) return [];
  return buttons
    .filter((b) => b && typeof b.title === "string" && b.title.trim())
    .map((b) => {
      const title = buttonTitle(b.title);
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
  /** Instagram вне 24-часового окна: HUMAN_AGENT — живой агент известному контакту, не рассылка. */
  messagingType?: "MESSAGE_TAG";
  messageTag?: "HUMAN_AGENT";
  /** Родной interactive-объект Meta (список WhatsApp); при нём Zernio игнорирует buttons. */
  interactive?: Json;
  /** Область ключа идемпотентности (event-context: idempotencyKeyFor); в тело не уходит. */
  idempotencyScope?: string;
};

/** failure — поля отказа Zernio: по ним очередь решает, повторять ли. */
export type SendResult = { ok: boolean; error?: string; failure?: ZernioFailure };

/**
 * Ошибка отправки словами продавца — по коду отказа, не по тексту. Окно 24
 * часа у WhatsApp — только 131047; 131026 — получатель недостижим.
 */
export function describeSendError(
  platform: ZernioPlatform,
  details: string,
  failure?: ZernioFailure,
): string {
  const kind = classifyZernioFailure(failure);
  if (kind === "window_closed")
    return platform === "instagram"
      ? "Прошло больше 24 часов с последнего сообщения покупателя — Instagram не даёт написать ему первым."
      : "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном.";
  if (platform === "whatsapp" && kind === "unreachable")
    return "Номер покупателя не принимает сообщения WhatsApp: WhatsApp на нём нет или приложение устарело.";
  const channel = platform === "whatsapp" ? "WhatsApp" : "Instagram";
  if (/inbox add-on required/i.test(details))
    return `Для этого аккаунта недоступна отправка сообщений (${channel}). Проверьте права подключения и тариф сервиса.`;
  if (kind === "rate_limited")
    return `${channel} временно ограничил отправку. Повторите через минуту.`;
  if (kind === "ambiguous")
    return `${channel} не подтвердил отправку: сообщение могло уйти. Проверьте переписку, прежде чем отправлять снова.`;
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
  if (opts.interactive) body.interactive = opts.interactive;
  else if (buttons.length) body.buttons = buttons;
  if (opts.messagingType) {
    body.messagingType = opts.messagingType;
    if (opts.messageTag) body.messageTag = opts.messageTag;
  }
  try {
    await request(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body,
      // Повтор доставки вебхука не должен обернуться вторым сообщением у покупателя.
      idempotencyKey: idempotencyKeyFor(body, opts.idempotencyScope),
    });
    return { ok: true };
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    console.error(`[zernio] send failed for ${conversationId}: ${details}`);
    const failure = zernioFailureOf(e);
    return { ok: false, error: describeSendError(platform, details, failure), failure };
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

/**
 * Отключить аккаунт в Zernio (DELETE /accounts/{id}). Подключить его снова
 * можно только заново через авторизацию, id при этом будет другой. Повторный
 * вызов для уже отключённого даёт 404; сам запрос не повторяем.
 */
export async function deleteAccount(accountId: string): Promise<void> {
  await request(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
}

export async function readWebhookSettings(): Promise<ZernioWebhookRecord[]> {
  const r = await request<{ webhooks?: ZernioWebhookRecord[] }>("/webhooks/settings");
  return r.webhooks ?? [];
}

/**
 * Записать вебхук v2 по плану planV2Webhook. План пишет только запись с
 * адресом этого деплоя (её id взят из той же выборки), чужие записи не
 * меняются и не удаляются. Секрет подписи уходит при создании и обновлении.
 */
export async function writeV2Webhook(
  plan: V2WebhookPlan,
): Promise<{ ok: boolean; error?: string }> {
  if (plan.action === "none" || plan.action === "unchanged") return { ok: true };
  const secret = env().ZERNIO_WEBHOOK_SECRET?.trim();
  if (!secret && plan.action !== "disable")
    return { ok: false, error: "ZERNIO_WEBHOOK_SECRET не задан" };
  const body =
    plan.action === "create"
      ? { ...plan.body, secret }
      : plan.action === "update"
        ? { webhookId: plan.id, ...plan.body, secret }
        : { webhookId: plan.id, isActive: false };
  try {
    const r = await request<{ success?: boolean; error?: string }>("/webhooks/settings", {
      method: plan.action === "create" ? "POST" : "PUT",
      body,
    });
    if (r.success === false)
      return { ok: false, error: r.error || "Zernio не принял настройки вебхука" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ── Instagram: быстрые вопросы нового диалога (ice breakers) ───────── */

export type IceBreaker = { question: string; payload: string };

/** До 4 вопросов по 80 символов; набор заменяет прежний целиком. */
export async function setInstagramIceBreakers(
  accountId: string,
  items: IceBreaker[],
): Promise<void> {
  await request(`/accounts/${encodeURIComponent(accountId)}/instagram-ice-breakers`, {
    method: "PUT",
    body: { ice_breakers: items },
  });
}

export async function deleteInstagramIceBreakers(accountId: string): Promise<void> {
  await request(`/accounts/${encodeURIComponent(accountId)}/instagram-ice-breakers`, {
    method: "DELETE",
  });
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
  /** Область ключа идемпотентности (очередь: outbox:<id>). */
  idempotencyScope?: string;
}): Promise<
  { ok: true; conversationId?: string } | { ok: false; error: string; failure?: ZernioFailure }
> {
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
    }>("/inbox/conversations", {
      method: "POST",
      body,
      idempotencyKey: idempotencyKeyFor(body, params.idempotencyScope),
    });
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
    const failure = zernioFailureOf(e);
    if (/TEMPLATE_REQUIRED/i.test(details))
      return {
        ok: false,
        error:
          "WhatsApp требует одобренный шаблон, чтобы написать первым. Создайте шаблон в разделе «Рассылки» и дождитесь одобрения Meta.",
        failure,
      };
    if (/Direct Send/i.test(details))
      return {
        ok: false,
        error:
          "Этот WhatsApp-аккаунт не допущен к отправке без шаблона. Нужен одобренный шаблон Meta.",
        failure,
      };
    return { ok: false, error: details, failure };
  }
}

/**
 * Свежая ссылка на вложение сообщения. Ссылки CDN Instagram и Facebook в
 * событии подписаны на время и истекают; Zernio по id сообщения у Meta и
 * месту вложения выдаёт новую (перевыпускает у Meta, если старая протухла).
 * null — не вышло: сообщение не нашлось, платформа не умеет, Zernio недоступен.
 */
export async function refreshAttachmentUrl(
  conversationId: string,
  platformMessageId: string,
  index: number,
  accountId: string,
): Promise<string | null> {
  try {
    const r = await request<{ url?: string }>(
      `/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(platformMessageId)}/attachments/${index}`,
      { query: { accountId, format: "json" }, timeoutMs: REFRESH_TIMEOUT_MS },
    );
    return typeof r.url === "string" && /^https?:\/\//i.test(r.url) ? r.url : null;
  } catch (e) {
    console.warn(
      `[zernio] вложение не перечитано: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
    );
    return null;
  }
}

/** Низкоуровневый запрос к Zernio — для соседних модулей канала (автоматизации, посты). */
export const zernioRequest = request;

/** Транспорт канала — подменяется в тестах, чтобы не ходить в Zernio. */
export type ZernioTransport = {
  send: typeof sendInboxMessage;
  tail: typeof listConversationMessages;
  /** Скачивание вложения (чек) — в тестах подменяется; живое — downloadAttachment. */
  download?: (
    url: string,
    accountId?: string | null,
  ) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Свежая ссылка на вложение (просроченный CDN) — в тестах подменяется; живое — refreshAttachmentUrl. */
  refresh?: typeof refreshAttachmentUrl;
  /** Готова ли почта платформы (SMTP) — в тестах подменяется; живое — isMailConfigured. */
  mailReady?: () => boolean;
  /**
   * Тип и размер фото в бакете — выбрать то, что примут Instagram/WhatsApp
   * (media.server). Без него — только по расширению (тесты).
   */
  imageInfo?: import("./media.server").ImageInfoReader;
};

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/**
 * Чек качается в фоне вебхука, и при мёртвой ссылке CDN попыток две (с
 * перечитыванием вложения между ними): худший случай 15 + 8 + 15 = 38 с.
 */
const DOWNLOAD_TIMEOUT_MS = 15_000;
const REFRESH_TIMEOUT_MS = 8_000;

/**
 * Скачать вложение покупателя (чек). Ссылки на API Zernio — с ключом
 * (attachmentNeedsZernioKey) и с принявшим аккаунтом (withReceivingAccount),
 * остальные (CDN Instagram) — как есть; только http(s), не больше 20 МБ.
 */
export async function downloadAttachment(
  rawUrl: string,
  accountId?: string | null,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const e = env();
    const url = withReceivingAccount(rawUrl, accountId, e.ZERNIO_BASE_URL);
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const key = e.ZERNIO_API_KEY?.trim();
    const headers: Record<string, string> =
      key && attachmentNeedsZernioKey(url, e.ZERNIO_BASE_URL)
        ? { Authorization: `Bearer ${key}` }
        : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[zernio] вложение не скачалось: HTTP ${res.status} (${u.host})`);
      return null;
    }
    const bytes = await readCapped(res, MAX_ATTACHMENT_BYTES);
    if (!bytes?.byteLength) return null;
    return {
      bytes,
      mime: res.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export const liveTransport: ZernioTransport = {
  send: sendInboxMessage,
  tail: listConversationMessages,
  download: downloadAttachment,
  refresh: refreshAttachmentUrl,
  imageInfo: async (ctx, path) => (await import("./media.server")).storageImageInfo(ctx, path),
};

export { readCapped };
