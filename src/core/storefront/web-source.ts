/**
 * Откуда покупатель пришёл на витрину сайта: utm_source, utm_campaign и ref
 * из первой ссылки. Браузер запоминает их при входе (routes/s.$slug.tsx),
 * при оформлении заказа они ложатся в state.first_source покупателя — туда
 * же, куда бот пишет /start (карточка покупателя, core/customers/card).
 *
 * Значения приходят из адреса, который может прислать кто угодно, поэтому
 * только латиница, цифры и `_.-`, до 40 знаков каждое, вся строка — до 64,
 * как у бота.
 */
export const WEB_SOURCE_PREFIX = "site:";
const PART = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX = 64;

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return PART.test(s) ? s : null;
};

/** `site:google/spring`, `site:ref-anna`; ничего годного — null. */
export function webSource(params: {
  utm_source?: unknown;
  utm_campaign?: unknown;
  ref?: unknown;
}): string | null {
  const source = clean(params.utm_source);
  const campaign = clean(params.utm_campaign);
  const ref = clean(params.ref);
  const parts = [source ? (campaign ? `${source}/${campaign}` : source) : null, ref && `ref-${ref}`]
    .filter(Boolean)
    .join(" ");
  if (!parts) return null;
  return `${WEB_SOURCE_PREFIX}${parts}`.slice(0, MAX);
}

/** Строка из браузера перед записью в базу: только то, что мог собрать webSource. */
export function isWebSource(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX && /^site:[A-Za-z0-9_.\-/ ]{1,59}$/.test(v);
}

/** Ключ в браузере; первая ссылка не перезаписывается следующими. */
export const webSourceStorageKey = (slug: string) => `ff-source:${slug}`;
