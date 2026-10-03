import { serviceDb } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * История оплат подписки для продавца: платежи (период, сумма, дата) и счета
 * (выставлен, оплачен, отклонён — с причиной). Только по своему магазину;
 * реквизиты, чек и служебные заметки оператора продавцу не отдаются.
 */
export const HISTORY_PAGE = 10;

export type HistoryKind = "payments" | "invoices";

export type PaymentRow = {
  id: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  paid_at: string;
};

export type InvoiceRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  reject_reason: string | null;
};

export type HistoryPage<T> = { rows: T[]; total: number; page: number; pageSize: number };

/** Страница с уникальным ключом сортировки (`id`): строки не двоятся и не теряются между страницами. */
export async function billingHistory(
  botId: string,
  kind: "payments",
  page: number,
): Promise<HistoryPage<PaymentRow>>;
export async function billingHistory(
  botId: string,
  kind: "invoices",
  page: number,
): Promise<HistoryPage<InvoiceRow>>;
export async function billingHistory(
  botId: string,
  kind: HistoryKind,
  rawPage: number,
): Promise<HistoryPage<PaymentRow> | HistoryPage<InvoiceRow>> {
  const page = Math.max(0, Math.floor(rawPage) || 0);
  const from = page * HISTORY_PAGE;
  const range: [number, number] = [from, from + HISTORY_PAGE - 1];
  if (kind === "payments") {
    const { data, error, count } = await serviceDb()
      .from("subscription_payments")
      .select("id, period_start, period_end, amount, currency, paid_at", { count: "exact" })
      .eq("bot_id", botId)
      .order("paid_at", { ascending: false })
      .order("id", { ascending: false })
      .range(...range);
    if (error) throw serverFailure(`История оплат: ${error.message}`);
    return {
      // Поля названы явно: лишнее из строки (заметка оператора) продавцу не уйдёт.
      rows: (data ?? []).map((p) => ({
        id: p.id,
        period_start: p.period_start,
        period_end: p.period_end,
        amount: Number(p.amount),
        currency: p.currency,
        paid_at: p.paid_at,
      })),
      total: count ?? 0,
      page,
      pageSize: HISTORY_PAGE,
    };
  }
  const { data, error, count } = await serviceDb()
    .from("subscription_invoices")
    .select("id, amount, currency, status, created_at, confirmed_at, reject_reason", {
      count: "exact",
    })
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(...range);
  if (error) throw serverFailure(`История счетов: ${error.message}`);
  return {
    rows: (data ?? []).map((i) => ({
      id: i.id,
      amount: Number(i.amount),
      currency: i.currency,
      status: i.status,
      created_at: i.created_at,
      confirmed_at: i.confirmed_at,
      reject_reason: i.reject_reason,
    })),
    total: count ?? 0,
    page,
    pageSize: HISTORY_PAGE,
  };
}
