import { createHmac, randomUUID } from "node:crypto";
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Интеграция с CRM и Таблицами (модуль crm_integration): события заказа
 * уходят POST-запросом JSON на адрес продавца — amoCRM/Bitrix24 через их
 * входящие вебхуки, Google Таблицы через веб-приложение Apps Script, Make,
 * Zapier. Подпись — HMAC-SHA256 тела секретом продавца в заголовке
 * `X-FrogFlow-Signature: sha256=<hex>`. Доставка — через outbox: отказ
 * адресата повторяется с растущей паузой и виден в «Не доставлено».
 * Адрес — только https и не во внутреннюю сеть (защита от SSRF).
 */
export const CRM_KEY = "crm_webhook";

export const CRM_EVENTS = [
  "placed",
  "proof",
  "delivered",
  "delivery_failed",
  "rejected",
  "status",
  "payment",
  "refund",
  "courier",
] as const;
export type CrmEvent = (typeof CRM_EVENTS)[number];

export type CrmConfig = { url: string; secret: string; events: CrmEvent[] };

export function parseCrm(raw: string | null | undefined): CrmConfig | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<CrmConfig>;
    if (typeof p.url !== "string" || !safeWebhookUrl(p.url)) return null;
    const events = Array.isArray(p.events)
      ? p.events.filter((e): e is CrmEvent => (CRM_EVENTS as readonly string[]).includes(e))
      : [...CRM_EVENTS];
    return { url: p.url, secret: typeof p.secret === "string" ? p.secret : "", events };
  } catch {
    return null;
  }
}

const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;

function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** 16 байт адреса IPv6 (в том числе с IPv4 в хвосте) или null, если запись неверная. */
function ipv6Bytes(ip: string): number[] | null {
  let tail: number[] = [];
  let s = ip;
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[2]!.split(".").map(Number);
    if (p.some((x) => !Number.isInteger(x) || x > 255)) return null;
    tail = p;
    s = v4[1]!.endsWith("::") ? v4[1]! : v4[1]!.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const want = 8 - tail.length / 2;
  const fill = want - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const words = [...head, ...Array<string>(Math.max(fill, 0)).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return null;
    const n = parseInt(w, 16);
    bytes.push(n >> 8, n & 255);
  }
  return [...bytes, ...tail];
}

const v4At = (b: number[], i: number) => b.slice(i, i + 4).join(".");
const zeros = (b: number[], from: number, to: number) => b.slice(from, to).every((x) => x === 0);

/**
 * Адрес во внутренней сети (или служебный): loopback, частные диапазоны,
 * link-local (в том числе метаданные облака 169.254.169.254), CGNAT,
 * multicast. IPv6 разбирается побайтно, так что любая запись (полная,
 * сжатая, с IPv4 в хвосте) даёт один ответ: ::/96 и ::ffff:0:0/96 (IPv4
 * внутри IPv6), NAT64 64:ff9b::/96 и 6to4 2002::/16 — по вложенному IPv4;
 * локальный NAT64, Teredo, документация, fc00::/7, fe80::/10, fec0::/10,
 * ff00::/8 — внутренние. Неразборчивая запись — тоже.
 */
export function isPrivateAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ipv4Private(ip);
  if (!ip.includes(":")) return true;
  const b = ipv6Bytes(ip.replace(/%.*$/, ""));
  if (!b) return true;
  const w0 = (b[0]! << 8) | b[1]!;
  const w1 = (b[2]! << 8) | b[3]!;
  // ::/96 (устаревшие IPv4-совместимые, ::, ::1) и ::ffff:0:0/96.
  if (zeros(b, 0, 12)) return ipv4Private(v4At(b, 12));
  if (zeros(b, 0, 10) && b[10] === 255 && b[11] === 255) return ipv4Private(v4At(b, 12));
  // NAT64: 64:ff9b::/96 — шлюз во вложенный IPv4; 64:ff9b:1::/48 — локальный.
  if (w0 === 0x64 && w1 === 0xff9b && zeros(b, 4, 12)) return ipv4Private(v4At(b, 12));
  if (w0 === 0x64 && w1 === 0xff9b) return true;
  if (w0 === 0x2002) return ipv4Private(v4At(b, 2));
  if (w0 === 0x2001 && w1 === 0) return true; // Teredo
  if (w0 === 0x2001 && w1 === 0x0db8) return true; // документация
  if (w0 === 0x0100 && zeros(b, 2, 8)) return true; // 100::/64 — сброс
  return (
    (w0 & 0xfe00) === 0xfc00 ||
    (w0 & 0xffc0) === 0xfe80 ||
    (w0 & 0xffc0) === 0xfec0 ||
    (w0 & 0xff00) === 0xff00
  );
}

const isIpLiteral = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("[");

/**
 * Только https и публичный хост — сервер не должен ходить во внутреннюю сеть
 * по просьбе продавца. Проверка по записи адреса; имя, которое резолвится во
 * внутренний адрес (127.0.0.1.nip.io), ловит pinnedLookup при соединении.
 */
export function safeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (PRIVATE_NAME.test(host)) return false;
    return isIpLiteral(host) ? !isPrivateAddress(host) : true;
  } catch {
    return false;
  }
}

type ResolvedAddress = { address: string; family: number };
type LookupCallback = (
  err: Error | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

/**
 * lookup для соединения: резолвит имя один раз, проверяет все адреса и
 * отдаёт сокету именно проверенный. Так подмена DNS между проверкой и
 * запросом (DNS rebinding) не срабатывает — второго резолва нет.
 */
export function pinnedLookup(
  resolve: (host: string) => Promise<ResolvedAddress[]> = async (host) => {
    const { lookup } = await import("node:dns/promises");
    return lookup(host, { all: true, verbatim: true });
  },
) {
  return (hostname: string, options: { all?: boolean }, cb: LookupCallback): void => {
    resolve(hostname).then(
      (addrs) => {
        if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
          return cb(new Error("адрес вебхука ведёт во внутреннюю сеть"), "", 0);
        if (options.all) return cb(null, addrs);
        cb(null, addrs[0]!.address, addrs[0]!.family);
      },
      (e: unknown) => cb(e instanceof Error ? e : new Error(String(e)), "", 0),
    );
  };
}

/** Ошибки, после которых запрос заведомо не ушёл: соединения не было. */
const NOT_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** timedOut — ответа не дождались; notSent — запрос заведомо не ушёл (повтор безопасен). */
export type PinnedFailure = { ok: false; error: string; timedOut?: boolean; notSent?: boolean };

/**
 * POST по https с закреплённым адресом (pinnedLookup). Редиректы не
 * выполняются: ответ 3xx возвращается как есть. Сертификат проверяется по
 * имени из адреса.
 */
export async function postPinned(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ ok: true; status: number } | PinnedFailure> {
  const { request } = await import("node:https");
  const u = new URL(url);
  return new Promise((done) => {
    const req = request(
      u,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup: pinnedLookup() as never,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        res.resume();
        res.on("end", () => done({ ok: true, status: res.statusCode ?? 0 }));
        res.on("error", (e) => done({ ok: false, error: e.message }));
      },
    );
    req.on("error", (e) =>
      done({
        ok: false,
        error: e.message,
        ...(e.name === "TimeoutError" || (e as { code?: string }).code === "ABORT_ERR"
          ? { timedOut: true }
          : {}),
        ...(NOT_SENT_CODES.has((e as { code?: string }).code ?? "") ? { notSent: true } : {}),
      }),
    );
    req.end(body);
  });
}

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function loadCrm(ctx: TenantContext): Promise<CrmConfig | null> {
  return parseCrm(await getSetting(ctx, CRM_KEY));
}

export async function saveCrm(ctx: TenantContext, cfg: CrmConfig | null): Promise<void> {
  await setSetting(ctx, CRM_KEY, cfg ? JSON.stringify(cfg) : "");
}

/** Тело события: заказ плоско, позиции списком — то, что удобно положить строкой в таблицу. */
export async function crmPayload(
  ctx: TenantContext,
  event: string,
  orderId: number,
  extra: Record<string, Json | undefined> = {},
): Promise<Record<string, Json> | null> {
  const { data: o } = await ctx.db
    .from("orders")
    .select(
      "id, order_no, display_no, status, total, currency, platform, display_name, username, contact, customer_email, country_name, fulfillment_kind, created_at, order_items(name_snapshot, quantity, price_snapshot)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!o) return null;
  return {
    event: `order.${event}`,
    at: new Date().toISOString(),
    shop_id: ctx.tenant.id,
    /** Один на событие; повтор из журнала несёт тот же — CRM отбросит дубль. */
    event_id: randomUUID(),
    order: {
      id: o.id,
      number: o.display_no ?? o.order_no,
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      channel: o.platform,
      customer: o.display_name,
      username: o.username,
      phone: o.contact,
      email: o.customer_email,
      country: o.country_name,
      kind: o.fulfillment_kind,
      created_at: o.created_at,
      items: (o.order_items ?? []).map((i) => ({
        name: i.name_snapshot,
        qty: i.quantity,
        price: Number(i.price_snapshot),
      })),
    },
    details: extra as Json,
  };
}

/** Поставить событие в очередь доставки (core/outbox); ушлёт минутный крон. */
export async function queueCrmEvent(
  ctx: TenantContext,
  event: string,
  orderId: number,
  extra: Record<string, Json | undefined> = {},
): Promise<boolean> {
  if (!ctx.tenant.modules.crm_integration) return false;
  if (!(CRM_EVENTS as readonly string[]).includes(event)) return false;
  const cfg = await loadCrm(ctx);
  if (!cfg || !cfg.events.includes(event as CrmEvent)) return false;
  const body = await crmPayload(ctx, event, orderId, extra);
  if (!body) return false;
  const { enqueueOutbox } = await import("@/core/outbox/outbox");
  await enqueueOutbox(
    ctx,
    {
      kind: "crm_webhook",
      target: { channel: "webhook", url: cfg.url },
      text: JSON.stringify(body),
      orderId,
      audience: "admin",
    },
    null,
  );
  return true;
}
