import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { listLeads } from "./leads";
import {
  CLOSED_ORDER_STATUSES,
  PIPELINE_STAGES,
  isClosedStage,
  orderStage,
  type LeadSource,
  type PipelineStage,
} from "./stages";

/** Закрытые сделки видны на доске столько дней; открытые — всегда. */
export const CLOSED_WINDOW_DAYS = 30;
/** Потолок карточек из заказов за один показ доски. */
const ORDER_LIMIT = 500;

export type BoardCard = {
  kind: "order" | "lead";
  id: string;
  stage: PipelineStage;
  title: string;
  contact: string | null;
  amount: number | null;
  currency: string | null;
  createdAt: string;
  /** Заказ: номер для покупателя и канал. */
  orderNo?: number;
  platform?: string;
  /** Заявка: источник, заметка, ответственный. */
  source?: LeadSource;
  note?: string | null;
  owner?: string | null;
};

export type Board = { columns: Array<{ stage: PipelineStage; cards: BoardCard[] }> };

type OrderRow = {
  id: number;
  order_no: number | null;
  display_no: number | null;
  display_name: string | null;
  contact: string | null;
  total: number | string | null;
  currency: string | null;
  status: string;
  platform: string | null;
  created_at: string;
};

const ORDER_COLS =
  "id, order_no, display_no, display_name, contact, total, currency, status, platform, created_at";

export function requirePipeline(ctx: TenantContext): void {
  if (!ctx.tenant.modules.crm_pipeline)
    throw new UserError("err.auth.moduleOff", "Модуль «{module}» не подключён к вашему тарифу.", {
      module: "Воронка сделок",
    });
}

/** Доска: открытые заказы и заявки — все, закрытые — за последние CLOSED_WINDOW_DAYS дней. */
export async function pipelineBoard(ctx: TenantContext, now = new Date()): Promise<Board> {
  requirePipeline(ctx);
  const since = new Date(now.getTime() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString();
  const closedList = `(${CLOSED_ORDER_STATUSES.join(",")})`;
  const [open, recent, leads] = await Promise.all([
    ctx.db
      .from("orders")
      .select(ORDER_COLS)
      .not("status", "in", closedList)
      .order("created_at", { ascending: true })
      .limit(ORDER_LIMIT),
    ctx.db
      .from("orders")
      .select(ORDER_COLS)
      .in("status", CLOSED_ORDER_STATUSES)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(ORDER_LIMIT),
    listLeads(ctx),
  ]);
  if (open.error) throw new Error(`Заказы не прочитались: ${open.error.message}`);
  if (recent.error) throw new Error(`Заказы не прочитались: ${recent.error.message}`);

  const cards: BoardCard[] = [];
  for (const o of [...(open.data ?? []), ...(recent.data ?? [])] as OrderRow[]) {
    cards.push({
      kind: "order",
      id: String(o.id),
      stage: orderStage(o.status),
      title: o.display_name?.trim() || `Заказ №${o.display_no ?? o.order_no ?? o.id}`,
      contact: o.contact,
      amount: o.total == null ? null : Number(o.total),
      currency: o.currency,
      createdAt: o.created_at,
      orderNo: Number(o.display_no ?? o.order_no ?? o.id),
      platform: o.platform ?? "telegram",
    });
  }
  for (const l of leads) {
    if (isClosedStage(l.stage) && (l.closed_at ?? l.updated_at) < since) continue;
    cards.push({
      kind: "lead",
      id: l.id,
      stage: l.stage,
      title: l.name || l.contact,
      contact: l.contact || null,
      amount: l.amount,
      currency: l.currency,
      createdAt: l.created_at,
      source: l.source,
      note: l.note,
      owner: l.owner,
    });
  }
  // Свежие сверху: продавец начинает с новых.
  cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    columns: PIPELINE_STAGES.map((stage) => ({
      stage,
      cards: cards.filter((c) => c.stage === stage),
    })),
  };
}
