/**
 * Жалоба на магазин или товар с площадки (В11). Хранится событием `market.report` в
 * `zernio_logs` магазина, на которого жалуются: схема базы не меняется, ретеншн такие
 * события не удаляет (core/retention). Закрывает жалобу оператор: «скрыл с площадки» или
 * «отклонил». Жалоба публичная, без входа, поэтому от повторов и потока защищают
 * отметки на сутки (адрес и устройство) и потолок жалоб с одного адреса.
 */
export const REPORT_EVENT = "market.report";
/** Отметка «этот адрес или устройство уже жаловались на этот объект сегодня». */
export const REPORT_CLAIM_EVENT = "market.report.claim";

export const REPORT_REASONS = [
  "fraud",
  "not_delivered",
  "prohibited",
  "copyright",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUS = { open: "open", closed: "closed" } as const;
export type ReportResolution = "hidden" | "dismissed";

/** С одного адреса за сутки — не больше стольких жалоб на разные объекты. */
export const REPORT_LIMITS = { perIpPerDay: 5 } as const;

export const REPORT_TEXT_MAX = 1000;

export type ReportInput = {
  slug: string;
  productId: string | null;
  reason: ReportReason;
  text: string;
};

export type ReportError = "reason" | "text";

export const isReportReason = (v: unknown): v is ReportReason =>
  typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Разбор формы: причина из списка; для «другое» текст обязателен, для остальных — по желанию. */
export function cleanReport(
  raw: Record<string, unknown>,
): { ok: true; value: ReportInput } | { ok: false; error: ReportError } {
  if (!isReportReason(raw.reason)) return { ok: false, error: "reason" };
  const text =
    typeof raw.text === "string"
      ? raw.text.trim().replace(/\s+/g, " ").slice(0, REPORT_TEXT_MAX)
      : "";
  if (raw.reason === "other" && text.length < 5) return { ok: false, error: "text" };
  const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase().slice(0, 80) : "";
  const product = typeof raw.productId === "string" ? raw.productId.trim() : "";
  return {
    ok: true,
    value: {
      slug,
      productId: UUID.test(product) ? product.toLowerCase() : null,
      reason: raw.reason,
      text,
    },
  };
}

/** День по UTC для отметок: один день у всех экземпляров функции. */
export const reportDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Ключ жалобы: объект (магазин или товар), вид отметки (адрес или устройство), хеш, день.
 * Он же `event_id` строки — уникальный, поэтому из двух одновременных жалоб проходит одна.
 */
export const reportEventId = (
  botId: string,
  target: string,
  kind: "ip" | "device",
  hash: string,
  day: string,
): string => `${REPORT_EVENT}:${botId}:${target}:${kind}:${hash.slice(0, 16)}:${day}`;

export const reportTarget = (productId: string | null): string => productId ?? "shop";
