import { serviceDb, type Db } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";
import { resolveTenant, tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { shownOnMarketplace } from "./consent";
import {
  REPORT_CLAIM_EVENT,
  REPORT_EVENT,
  REPORT_LIMITS,
  REPORT_STATUS,
  isReportReason,
  reportDay,
  reportEventId,
  reportTarget,
  type ReportInput,
  type ReportReason,
  type ReportResolution,
} from "./report";

/**
 * Приём и разбор жалоб площадки (В11). Жалоба идёт от анонима и касается чужого магазина,
 * поэтому, как каталог площадки, пишется под serviceDb; строка — событие `market.report`
 * в `zernio_logs` магазина (схема не меняется). Повтор с того же адреса или устройства на
 * тот же объект за сутки — не новая жалоба: отметка с уникальным `event_id` берётся ДО
 * записи, проигравший гонку (23505) ничего не пишет.
 */
type Shop = { tenant: Tenant; db: Db };
type Deps = {
  svc?: Db;
  now?: () => Date;
  /** Магазин по адресу витрины; нет, не на площадке или не на v2 — null. */
  shop?: (slug: string) => Promise<Shop | null>;
};

export type SubmitResult =
  { status: "sent" | "duplicate" } | { status: "refused"; reason: "unknown" | "ip" };

const DAY = 86_400_000;

async function shownShop(slug: string): Promise<Shop | null> {
  if (!slug) return null;
  const tenant = await resolveTenant({ by: "slug", value: slug });
  // Жалуются на то, что видно на площадке: скрытый, ждущий одобрения и чужой платформы — нет.
  if (!tenant || !shownOnMarketplace(tenant)) return null;
  return { tenant, db: tenantContext(tenant).db };
}

/** Что видит заявитель в форме: название магазина (и товара). Не на площадке — null. */
export async function describeTarget(
  slug: string,
  productId: string | null,
  deps: Pick<Deps, "shop"> = {},
): Promise<{ shop: string; product: string | null } | null> {
  const found = await (deps.shop ?? shownShop)(slug);
  if (!found) return null;
  if (!productId) return { shop: found.tenant.name, product: null };
  const { data, error } = await found.db
    .from("products")
    .select("name")
    .eq("bot_id", found.tenant.id)
    .eq("id", productId)
    .limit(1);
  if (error) throw serverFailure(`жалоба площадки: товар не прочитан: ${error.message}`);
  const row = (data ?? [])[0] as { name: string } | undefined;
  return row ? { shop: found.tenant.name, product: String(row.name ?? "") } : null;
}

export async function submitReport(
  input: ReportInput,
  ipHash: string,
  deviceHash: string | null,
  deps: Deps = {},
): Promise<SubmitResult> {
  const svc = deps.svc ?? serviceDb();
  const now = (deps.now ?? (() => new Date()))();
  const shop = await (deps.shop ?? shownShop)(input.slug);
  if (!shop) return { status: "refused", reason: "unknown" };
  const { tenant } = shop;

  let productName: string | null = null;
  if (input.productId) {
    const { data, error } = await shop.db
      .from("products")
      .select("id, name")
      .eq("bot_id", tenant.id)
      .eq("id", input.productId)
      .limit(1);
    if (error) throw serverFailure(`жалоба площадки: товар не прочитан: ${error.message}`);
    const row = (data ?? [])[0] as { id: string; name: string } | undefined;
    if (!row) return { status: "refused", reason: "unknown" };
    productName = String(row.name ?? "").slice(0, 200);
  }

  const reporter = ipHash.slice(0, 16);
  // Потолок с одного адреса на разные объекты: иначе одна рука забьёт список оператора.
  const { count, error: countError } = await svc
    .from("zernio_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", REPORT_EVENT)
    .eq("payload->>reporter", reporter)
    .gte("created_at", new Date(now.getTime() - DAY).toISOString());
  if (countError) throw serverFailure(`жалоба площадки: лимит не прочитан: ${countError.message}`);
  if ((count ?? 0) >= REPORT_LIMITS.perIpPerDay) return { status: "refused", reason: "ip" };

  const day = reportDay(now);
  const target = reportTarget(input.productId);
  const eventId = reportEventId(tenant.id, target, "ip", ipHash, day);
  const { error } = await svc.from("zernio_logs").insert({
    bot_id: tenant.id,
    event_id: eventId,
    event_type: REPORT_EVENT,
    status: REPORT_STATUS.open,
    created_at: now.toISOString(),
    payload: {
      slug: input.slug,
      shop: tenant.name.slice(0, 200),
      product_id: input.productId,
      product: productName,
      reason: input.reason,
      text: input.text,
      reporter,
    },
  });
  if (error?.code === "23505") return { status: "duplicate" };
  if (error) throw serverFailure(`жалоба площадки: не записана: ${error.message}`);

  // Устройство: тот же человек с другого адреса (мобильная сеть) вторую жалобу не добавит.
  if (deviceHash) {
    const claim = await svc.from("zernio_logs").insert({
      bot_id: tenant.id,
      event_id: reportEventId(tenant.id, target, "device", deviceHash, day),
      event_type: REPORT_CLAIM_EVENT,
      status: "processed",
      created_at: now.toISOString(),
      payload: {},
    });
    if (claim.error) {
      const { error: undo } = await svc.from("zernio_logs").delete().eq("event_id", eventId);
      if (undo) throw serverFailure(`жалоба площадки: отметка не снята: ${undo.message}`);
      if (claim.error.code === "23505") return { status: "duplicate" };
      throw serverFailure(
        `жалоба площадки: отметка устройства не записана: ${claim.error.message}`,
      );
    }
  }
  return { status: "sent" };
}

export type ReportRow = {
  id: string;
  botId: string;
  slug: string;
  shop: string;
  productId: string | null;
  product: string | null;
  reason: ReportReason;
  text: string;
  at: string;
};

export const REPORTS_PAGE = 50;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

type LogRow = { id: string; bot_id: string; created_at: string; payload: unknown };

function toRow(r: LogRow): ReportRow {
  const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<
    string,
    unknown
  >;
  return {
    id: r.id,
    botId: r.bot_id,
    slug: str(p.slug),
    shop: str(p.shop),
    productId: str(p.product_id) || null,
    product: str(p.product) || null,
    reason: isReportReason(p.reason) ? p.reason : "other",
    text: str(p.text),
    at: r.created_at,
  };
}

/** Открытые жалобы, новые сверху; сортировка кончается `id`, страницы не теряют строк. */
export async function listOpenReports(
  offset = 0,
  svc: Db = serviceDb(),
): Promise<{ reports: ReportRow[]; total: number; next: number | null }> {
  const from = Math.max(0, Math.floor(offset));
  const { data, error, count } = await svc
    .from("zernio_logs")
    .select("id, bot_id, created_at, payload", { count: "exact" })
    .eq("event_type", REPORT_EVENT)
    .eq("status", REPORT_STATUS.open)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + REPORTS_PAGE - 1);
  if (error) throw serverFailure(`жалобы площадки не прочитаны: ${error.message}`);
  const reports = ((data ?? []) as LogRow[]).map(toRow);
  const total = count ?? reports.length;
  return { reports, total, next: from + reports.length < total ? from + reports.length : null };
}

/** Одна открытая жалоба: нет такой или уже закрыта — null. */
export async function getOpenReport(id: string, svc: Db = serviceDb()): Promise<ReportRow | null> {
  const { data, error } = await svc
    .from("zernio_logs")
    .select("id, bot_id, created_at, payload")
    .eq("id", id)
    .eq("event_type", REPORT_EVENT)
    .eq("status", REPORT_STATUS.open)
    .limit(1);
  if (error) throw serverFailure(`жалоба площадки не прочитана: ${error.message}`);
  const row = ((data ?? []) as LogRow[])[0];
  return row ? toRow(row) : null;
}

/**
 * Закрыть жалобу: условное обновление по статусу «open», решение остаётся в строке.
 * false — её уже закрыл другой щелчок.
 */
export async function closeReport(
  id: string,
  resolution: ReportResolution,
  by: string,
  now = new Date(),
  svc: Db = serviceDb(),
): Promise<boolean> {
  const { data: cur, error: readError } = await svc
    .from("zernio_logs")
    .select("payload")
    .eq("id", id)
    .eq("event_type", REPORT_EVENT)
    .eq("status", REPORT_STATUS.open)
    .limit(1);
  if (readError) throw serverFailure(`жалоба площадки не прочитана: ${readError.message}`);
  if ((cur ?? []).length === 0) return false;
  const payload = ((cur ?? [])[0] as { payload?: Record<string, unknown> } | undefined)?.payload;
  const { data, error } = await svc
    .from("zernio_logs")
    .update({
      status: REPORT_STATUS.closed,
      payload: { ...(payload ?? {}), resolution, resolved_by: by, resolved_at: now.toISOString() },
    })
    .eq("id", id)
    .eq("status", REPORT_STATUS.open)
    .select("id");
  if (error) throw serverFailure(`жалоба площадки не закрыта: ${error.message}`);
  return (data ?? []).length > 0;
}
