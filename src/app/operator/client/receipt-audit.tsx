/** Карточка клиента у оператора: аудит чеков (только чтение). */
import { useState } from "react";
import { receiptAuditInventoryFn, receiptAuditScanFn } from "@/app/operator/platform.functions";
import {
  ACTUAL_HANDLING_LABEL,
  auditOrderCaption,
  OCR_WOULD_LABEL,
  summarizeAuditRows,
  type AuditSeverity,
  type ReceiptAuditInventory,
  type ReceiptAuditRow,
  type SeenReceiptHash,
} from "@/core/receipts/audit";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

const AUDIT_TONE: Record<AuditSeverity, "ok" | "warn" | "neutral" | "danger"> = {
  ok: "ok",
  info: "neutral",
  warn: "warn",
  danger: "danger",
  skip: "neutral",
};

/** Сколько чеков с файлом прогоняет одна кнопка — чтобы не сжечь Vision на весь архив сразу. */
const AUDIT_BATCH = 20;

/**
 * Аудит чеков (перенос из v1): что сказала бы автопроверка по текущим
 * правилам против того, как заказ реально обработан. Только чтение.
 */
export function ReceiptAuditCard({ c }: { c: C }) {
  const [inv, setInv] = useState<ReceiptAuditInventory | null>(null);
  const [rows, setRows] = useState<ReceiptAuditRow[]>([]);
  const [cursor, setCursor] = useState<{ afterId: number; done: boolean; remaining: number }>({
    afterId: 0,
    done: false,
    remaining: 0,
  });
  const [onlyIssues, setOnlyIssues] = useState(true);
  const count = useAction(async () =>
    setInv(await receiptAuditInventoryFn({ data: { botId: c.id } })),
  );
  const scan = useAction(async () => {
    let afterId = cursor.afterId;
    let got = rows.slice();
    let checked = 0;
    while (checked < AUDIT_BATCH) {
      const seenHashes: SeenReceiptHash[] = got
        .filter((r) => r.proofHash)
        .map((r) => ({ hash: r.proofHash!, orderId: r.orderId, displayNo: r.displayNo }));
      const r = await receiptAuditScanFn({ data: { botId: c.id, afterId, seenHashes } });
      got = got.concat(r.rows);
      checked += r.rows.filter((x) => x.ocrReason !== "skip").length || 1;
      afterId = r.afterId;
      setRows(got);
      setCursor({ afterId: r.afterId, done: r.done, remaining: r.remaining });
      if (r.done) break;
    }
  });
  const sum = summarizeAuditRows(rows);
  const shown = onlyIssues ? rows.filter((r) => !r.comparison.agree) : rows;
  return (
    <Card title="Аудит чеков" className="mt-4">
      <p className="mb-3 text-sm text-muted">
        Прогоняет присланные чеки через автопроверку по текущим правилам и сравнивает с тем, как
        заказ обработан на самом деле. Заказы не меняются, лимит проверок клиента не тратится —
        Vision идёт с ключа платформы.
      </p>
      {!inv ? (
        <button
          className="btn-secondary"
          disabled={count.busy}
          onClick={() => void count.run().catch(() => {})}
        >
          Посчитать чеки
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Чеков с файлом: <b>{inv.withFile}</b> · полный прогон ≈ ${inv.estimatedUsd}
            {!inv.visionConfigured && <Badge tone="danger">ключ Vision не задан</Badge>}{" "}
            {inv.moduleEnabled ? (
              <Badge tone={inv.autoEnabled ? "ok" : "warn"}>
                {inv.autoEnabled ? "автопроверка включена" : "автопроверка выключена"}
              </Badge>
            ) : (
              <Badge>модуль автопроверки не подключён</Badge>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary"
              disabled={scan.busy || cursor.done || !inv.visionConfigured}
              onClick={() => void scan.run().catch(() => {})}
            >
              {scan.busy
                ? "Проверяю…"
                : rows.length === 0
                  ? `Проверить ${AUDIT_BATCH} последних`
                  : `Ещё ${AUDIT_BATCH}`}
            </button>
            {rows.length > 0 && (
              <span className="text-sm text-muted">
                {cursor.done ? "все чеки проверены" : `осталось ${cursor.remaining}`}
              </span>
            )}
          </div>
          {rows.length > 0 && (
            <>
              <p className="text-sm">
                Проверено {sum.total}: сошлось {sum.agree}
                {sum.danger > 0 && (
                  <>
                    {" "}
                    · <Badge tone="danger">опасно {sum.danger}</Badge>
                  </>
                )}
                {sum.warn > 0 && (
                  <>
                    {" "}
                    · <Badge tone="warn">внимание {sum.warn}</Badge>
                  </>
                )}
                {sum.wouldHaveAuto > 0 && ` · выдались бы сами: ${sum.wouldHaveAuto}`}
                {sum.skip > 0 && ` · не прочитано: ${sum.skip}`}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.currentTarget.checked)}
                />
                Только расхождения
              </label>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Заказ</th>
                      <th>В базе</th>
                      <th>OCR</th>
                      <th>Итог</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.orderId}>
                        <td className="whitespace-nowrap">
                          {auditOrderCaption(r.displayNo, r.adminNo)}
                          <div className="text-xs text-muted">
                            {r.expectedAmount} {r.currency ?? ""}
                          </div>
                        </td>
                        <td>{ACTUAL_HANDLING_LABEL[r.comparison.actual]}</td>
                        <td>{OCR_WOULD_LABEL[r.comparison.ocrWould]}</td>
                        <td>
                          <Badge tone={AUDIT_TONE[r.comparison.severity]}>
                            {r.comparison.title}
                          </Badge>
                          <div className="text-xs text-muted">{r.comparison.detail}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      <ErrorBox error={count.error ?? scan.error} />
    </Card>
  );
}
