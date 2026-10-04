import { serviceDb, type Db } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { marketplaceState, type MarketplaceState } from "@/core/marketplace/consent";
import {
  closeReport,
  getOpenReport,
  listOpenReports,
  type ReportRow,
} from "@/core/marketplace/report.server";
import type { ReportReason } from "@/core/marketplace/report";
import { logEvent, setMarketplaceHidden } from "./operator.server";

/**
 * Жалобы на магазины площадки (В11): список для оператора и решение «скрыть с площадки» /
 * «отклонить». Хранение и защита от повторов — core/marketplace/report.server.
 */
export const REPORT_REASON_RU: Record<ReportReason, string> = {
  fraud: "мошенничество или обман",
  not_delivered: "оплатил, заказ не получил",
  prohibited: "запрещённый товар или услуга",
  copyright: "чужие материалы без разрешения",
  other: "другое",
};

export type ReportItem = ReportRow & { reasonLabel: string; state: MarketplaceState | "gone" };

export async function marketReportsView(offset = 0, svc: Db = serviceDb()) {
  const page = await listOpenReports(offset, svc);
  const byId = new Map((await tenantDirectory()).map((t) => [t.id, t]));
  const reports: ReportItem[] = page.reports.map((r) => {
    const t = byId.get(r.botId);
    return {
      ...r,
      reasonLabel: REPORT_REASON_RU[r.reason],
      state: t ? marketplaceState(t) : "gone",
    };
  });
  return { reports, total: page.total, next: page.next };
}

/**
 * «Скрыть» убирает магазин с площадки (решение оператора сильнее согласия продавца) и закрывает
 * жалобу; «отклонить» только закрывает. Закрытие условное: двойной щелчок не повторяет решение.
 */
export async function resolveMarketReport(
  id: string,
  action: "hide" | "dismiss",
  actor = "operator",
): Promise<{ status: "done" | "already" }> {
  const report = await getOpenReport(id);
  if (!report) return { status: "already" };
  if (action === "hide") {
    const why = `Жалоба: ${REPORT_REASON_RU[report.reason]}${report.text ? `. ${report.text}` : ""}`;
    await setMarketplaceHidden(report.botId, true, why, actor);
  }
  const closed = await closeReport(id, action === "hide" ? "hidden" : "dismissed", actor);
  if (!closed) return { status: "already" };
  if (action === "dismiss")
    await logEvent(report.botId, "meta", { market_report: id, resolution: "dismissed" }, actor);
  return { status: "done" };
}
