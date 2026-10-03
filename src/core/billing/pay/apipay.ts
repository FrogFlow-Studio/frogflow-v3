import { PREVIEW_SEND_OFF, previewReadonly } from "@/lib/preview";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverFailure } from "@/lib/server-failure";
import type { IssueRequest, SubscriptionPayProvider } from "./provider";

/**
 * ApiPay (apipay.kz) — «кассир» Kaspi Pay платформы: по публичному API
 * ApiPay создаёт одноразовую ссылку на оплату на сумму счёта
 * (`POST /invoices/qr` со `static: true`). Владелец открывает ссылку, жмёт
 * «Оплатить в Kaspi» и платит; ApiPay присылает вебхук
 * `invoice.status_changed` со статусом `paid`, и счёт закрывается сам —
 * чек не нужен. Счёт узнаётся по `external_order_id` = `ff-inv:<id счёта>`.
 * Номер Kaspi владельца не нужен: платит тот, кто открыл ссылку.
 *
 * Ключ доступа и секрет вебхука — только в окружении (config/env.ts). В
 * песочнице ссылки ненастоящие, поэтому пока ApiPay не переведён в боевой
 * режим, способ предлагается одному тестовому магазину.
 */
export type ApipayConfig = {
  apiKey: string;
  /** https://api.apipay.kz/api/v1 без хвостового слэша. */
  baseUrl: string;
  /** Боевой режим: ссылки получают все магазины, песочные вебхуки не принимаются. */
  live: boolean;
  /** Песочница: единственный магазин, которому выставляется ссылка ApiPay. */
  sandboxBotId: string | null;
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export const APIPAY_ORDER_PREFIX = "ff-inv:";
/** Kaspi показывает покупателю только первые 60 символов описания. */
const DESCRIPTION_MAX = 60;
const TIMEOUT_MS = 8000;

export const apipayOrderId = (invoiceId: string) => `${APIPAY_ORDER_PREFIX}${invoiceId}`;

/** id счёта из `external_order_id`; чужие заказы (не наш префикс или не uuid) — null. */
export function parseApipayOrderId(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith(APIPAY_ORDER_PREFIX)) return null;
  const id = raw.slice(APIPAY_ORDER_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function apipayText(req: Pick<IssueRequest, "amount" | "currency" | "note">, url: string) {
  return (
    `Счёт на оплату подписки\n\nСумма: ${req.amount} ${req.currency}${req.note ? `\nЗа что: ${req.note}` : ""}` +
    `\n\nОплатить через Kaspi: ${url}\nОткройте ссылку и нажмите «Оплатить в Kaspi» — сумма уже подставлена.` +
    `\n\nСчёт закроется сам сразу после оплаты. Если подтверждение не пришло, пришлите чек (PDF или скриншот) следующим сообщением в этот чат.`
  );
}

function description(note: string | null): string {
  const s = (note ?? "").trim() || "Подписка FrogFlow";
  return s.length > DESCRIPTION_MAX ? `${s.slice(0, DESCRIPTION_MAX - 1)}…` : s;
}

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Причина отказа ApiPay по-человечески; код ошибки ApiPay — в скобках для журнала. */
function refusal(status: number, body: Record<string, unknown>): string {
  const code = [body.error_code, body.error].find((v) => typeof v === "string") as
    string | undefined;
  const msg = typeof body.message === "string" ? body.message : "";
  if (status === 401) return "ApiPay не принял ключ доступа (401) — проверьте APIPAY_API_KEY.";
  if (status === 403) return `ApiPay отказал в доступе (403${code ? `, ${code}` : ""}).`;
  if (status === 429) return `ApiPay: превышен лимит запросов (429${code ? `, ${code}` : ""}).`;
  return `ApiPay ответил ${status}${code ? ` (${code})` : ""}${msg ? `: ${msg}` : ""}`.slice(
    0,
    300,
  );
}

/** Способ оплаты «ссылка ApiPay»; `cfg` null — ApiPay не настроен, способ пропускается. */
export function apipayProvider(
  cfg: ApipayConfig | null,
  fetchImpl: Fetch = fetch,
): SubscriptionPayProvider {
  return {
    key: "apipay",
    async unavailable(req) {
      if (!cfg) return "ApiPay не настроен.";
      if (previewReadonly()) return PREVIEW_SEND_OFF;
      if (req.currency !== "KZT") return "Kaspi принимает только тенге.";
      if (!(req.amount > 0)) return "Сумма счёта должна быть больше нуля.";
      if (!cfg.live && req.botId !== cfg.sandboxBotId)
        return "ApiPay в режиме песочницы — ссылка выставляется только тестовому магазину.";
      return null;
    },
    async issue(req) {
      if (!cfg) throw new Error("ApiPay не настроен.");
      if (previewReadonly()) throw new Error(PREVIEW_SEND_OFF);
      let res: Response;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/invoices/qr`, {
          method: "POST",
          headers: {
            "X-API-Key": cfg.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            static: true,
            single_use: true,
            amount: req.amount,
            description: description(req.note),
            external_order_id: apipayOrderId(req.invoiceId),
            // Повтор того же счёта вернёт уже созданную ссылку, а не вторую.
            external_order_id_idempotency: req.invoiceId,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw serverFailure(`ApiPay недоступен: ${e instanceof Error ? e.message : String(e)}`);
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // 409 idempotency_conflict — ссылка на этот счёт уже есть, она в теле ответа.
      const ok = res.ok || (res.status === 409 && body.error_code === "idempotency_conflict");
      if (!ok) throw new Error(refusal(res.status, body));
      const url = httpsUrl(body.payment_url);
      if (!url) throw new Error("ApiPay не вернул ссылку на оплату.");
      const linkId = body.static_qr_id;
      return {
        provider: "apipay",
        externalId:
          typeof linkId === "number" || typeof linkId === "string" ? String(linkId) : null,
        ownerText: apipayText(req, url),
        payUrl: url,
      };
    },
  };
}

/**
 * Подпись вебхука: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 сырого тела>`
 * (docs/en/webhooks.md ApiPay). Считается по байтам тела как пришли, без
 * перекодирования; hex сравнивается без учёта регистра.
 */
export function verifyApipaySignature(
  rawBody: Uint8Array | string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
    "utf8",
  );
  const received = Buffer.from(header.trim().toLowerCase(), "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type ApipayEvent =
  | {
      kind: "paid";
      /** id счёта ApiPay (не наш). */
      apipayId: string;
      invoiceId: string;
      amount: number;
      /** is_sandbox из вебхука; null — поля нет (такая оплата считается песочной). */
      sandbox: boolean | null;
    }
  | { kind: "ignored"; reason: string };

/**
 * Разбор вебхука. Нас интересует только оплата нашего счёта; остальное
 * (другие события, статусы, чужие заказы в том же кабинете) — пропуск с
 * причиной для журнала.
 */
export function parseApipayWebhook(payload: unknown): ApipayEvent {
  const p = (payload ?? {}) as { event?: unknown; invoice?: Record<string, unknown> };
  if (p.event !== "invoice.status_changed") return { kind: "ignored", reason: `event ${p.event}` };
  const inv = p.invoice ?? {};
  if (inv.status !== "paid") return { kind: "ignored", reason: `status ${inv.status}` };
  const invoiceId = parseApipayOrderId(inv.external_order_id);
  if (!invoiceId) return { kind: "ignored", reason: "не наш заказ" };
  const amount = Number(inv.amount);
  if (!Number.isFinite(amount)) return { kind: "ignored", reason: "нет суммы" };
  return {
    kind: "paid",
    apipayId: String(inv.id ?? ""),
    invoiceId,
    amount,
    sandbox: typeof inv.is_sandbox === "boolean" ? inv.is_sandbox : null,
  };
}
