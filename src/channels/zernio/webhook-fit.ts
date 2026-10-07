/**
 * Вебхук Zernio для v2 — чистое решение, что записать, без ключа и сети.
 *
 * Zernio разрешает до 50 вебхуков на команду, у каждого — фильтр
 * `profileIds`: запись получает события только этих профилей. У v2 своя
 * запись: адрес — этот деплой, фильтр — профили клиентов на v2. Записи v1
 * (любой адрес, кроме нашего) код v2 никогда не меняет и не удаляет: клиенты
 * переезжают по одному, и у клиентов на старой платформе Instagram и
 * WhatsApp не должны замолчать. Запись пишется только по кнопке оператора
 * (connect.server syncV2Webhook), крон лишь читает её состояние.
 */
export const ZERNIO_V2_WEBHOOK_NAME = "FrogFlow v2";

export const ZERNIO_WEBHOOK_EVENTS = [
  "message.received",
  "comment.received",
  "account.disconnected",
  "whatsapp.template.status_updated",
  // WhatsApp принял отправку (200), но не доставил — других сигналов нет (сверка, п. 11).
  "message.failed",
] as const;

export type ZernioWebhookRecord = {
  _id?: string;
  id?: string;
  url?: string;
  name?: string;
  events?: string[];
  isActive?: boolean;
  active?: boolean;
  profileIds?: string[];
  accountIds?: string[];
};

const recordId = (w: ZernioWebhookRecord) => w._id || w.id || "";
const sameUrl = (a: string | undefined, b: string) =>
  Boolean(a) && a!.trim().replace(/\/+$/, "") === b.trim().replace(/\/+$/, "");

/** Запись v2 — та, что указывает на адрес этого деплоя. Всё остальное чужое. */
export function ownWebhook(
  webhooks: readonly ZernioWebhookRecord[],
  url: string,
): ZernioWebhookRecord | undefined {
  return webhooks.find((w) => sameUrl(w.url, url) && recordId(w));
}

/**
 * Профили, чьи сообщения запись v2 доставляет сейчас: запись есть, включена,
 * слушает message.received и не сужена до аккаунтов. Список профилей в ней
 * может отставать от клиентов (новый клиент ждёт кнопки оператора) — это беда
 * нового клиента, а не тех, кто в записи уже есть (ложная тревога 07.10).
 */
export function deliveredProfiles(webhooks: readonly ZernioWebhookRecord[], url: string): string[] {
  const own = ownWebhook(webhooks, url);
  if (!own) return [];
  const active = own.isActive !== false && own.active !== false;
  if (!active || !own.events?.includes("message.received") || own.accountIds?.length) return [];
  return [...new Set((own.profileIds ?? []).map((p) => p.trim()).filter(Boolean))].sort();
}

/** Профили Zernio клиентов, которых обслуживает v2, — фильтр записи v2. */
export function v2ProfileIds(
  tenants: readonly {
    settings: { served_by?: string; zernio?: { profile_id?: string } };
  }[],
): string[] {
  const ids = tenants
    .filter((t) => t.settings.served_by === "v2")
    .map((t) => t.settings.zernio?.profile_id?.trim())
    .filter((p): p is string => Boolean(p));
  return [...new Set(ids)].sort();
}

export type V2WebhookPlan =
  | { action: "unchanged"; id: string }
  /** Клиентов v2 с Zernio нет и записи нет — писать нечего. */
  | { action: "none" }
  | { action: "create"; body: V2WebhookBody }
  | { action: "update"; id: string; body: V2WebhookBody }
  /** Клиентов v2 не осталось: запись выключается (пустой фильтр значил бы «все профили»). */
  | { action: "disable"; id: string };

export type V2WebhookBody = {
  name: string;
  url: string;
  events: string[];
  isActive: true;
  profileIds: string[];
  /** Всегда пусто: фильтр только по профилям (id аккаунта меняется при переподключении). */
  accountIds: string[];
};

/**
 * Что сделать с записью v2. Пишется только своя запись (адрес этого
 * деплоя); пустой список профилей в Zernio снимает фильтр, поэтому без
 * клиентов v2 запись не создаётся, а существующая выключается.
 */
export function planV2Webhook(
  webhooks: readonly ZernioWebhookRecord[],
  url: string,
  profileIds: readonly string[],
): V2WebhookPlan {
  const own = ownWebhook(webhooks, url);
  const active = own ? own.isActive !== false && own.active !== false : false;
  if (!profileIds.length)
    return own && active ? { action: "disable", id: recordId(own) } : { action: "none" };
  const body: V2WebhookBody = {
    name: ZERNIO_V2_WEBHOOK_NAME,
    url,
    events: [...ZERNIO_WEBHOOK_EVENTS],
    isActive: true,
    profileIds: [...profileIds].sort(),
    accountIds: [],
  };
  if (!own) return { action: "create", body };
  const have = [...(own.profileIds ?? [])].sort();
  const fits =
    active &&
    ZERNIO_WEBHOOK_EVENTS.every((e) => own.events?.includes(e)) &&
    !own.accountIds?.length &&
    have.length === body.profileIds.length &&
    have.every((p, i) => p === body.profileIds[i]);
  return fits
    ? { action: "unchanged", id: recordId(own) }
    : { action: "update", id: recordId(own), body };
}

/** Записи, которые указывают не на этот деплой (v1 и прочие), — только для показа оператору. */
export function foreignWebhooks(
  webhooks: readonly ZernioWebhookRecord[],
  url: string,
): ZernioWebhookRecord[] {
  return webhooks.filter((w) => !sameUrl(w.url, url));
}
