import { useState } from "react";
import {
  disconnectPricelistSheetFn,
  importPricelistSheetFn,
  previewPricelistSheetFn,
} from "../pricelist.functions";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { intlLocale, type AdminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import { type CardProps } from "./shared";

/** Прайс из Google-таблицы. */

export type SheetPreview = Awaited<ReturnType<typeof previewPricelistSheetFn>>;

/** Прайс из Google Таблицы: проверка с разницей, загрузка, статус автообновления. */
export function SheetCard({
  t,
  data,
  date,
  canEdit,
  onDone,
  locale,
}: CardProps & { date: (s: string) => string; locale: Locale }) {
  const loc = intlLocale(locale);
  const [url, setUrl] = useState(data.sheet?.url ?? "");
  const [preview, setPreview] = useState<{ url: string; result: SheetPreview } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const reason = (r: string) =>
    r === "noRows" || r === "shrunk" || r === "changed" || r === "pricesJumped"
      ? t(`pricelist.sheet.reason.${r}`)
      : t(`sheet.reason.${r}` as Parameters<AdminT>[0]);
  const check = useAction(async () => {
    setPreview(null);
    setDone(null);
    const link = url.trim();
    setPreview({ url: link, result: await previewPricelistSheetFn({ data: { url: link } }) });
  });
  const load = useAction(async () => {
    if (!preview?.result.ok) return;
    const r = await importPricelistSheetFn({
      data: { url: preview.url, fingerprint: preview.result.fingerprint },
    });
    if (!r.ok) {
      setPreview({ url: preview.url, result: r });
      return;
    }
    setPreview(null);
    setDone(r.meta.count);
    await onDone();
  });
  const disconnect = useAction(async () => {
    if (!confirm(t("pricelist.sheet.disconnectConfirm"))) return;
    await disconnectPricelistSheetFn();
    setUrl("");
    setPreview(null);
    await onDone();
  });
  const money = (n: number) => n.toLocaleString(loc);
  const status = data.sheet?.status ?? null;
  const p = preview?.result;
  return (
    <Card title={t("pricelist.sheet.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.sheet.hint")}</p>
      {data.sheet && (
        <div className="mb-3 space-y-1 text-sm">
          <p>
            {t("pricelist.sheet.connected")}{" "}
            <a
              className="break-all underline"
              href={data.sheet.url}
              target="_blank"
              rel="noreferrer"
            >
              {data.sheet.url}
            </a>
          </p>
          {status?.lastOkAt ? (
            <p>
              {t("pricelist.sheet.lastOk", {
                date: date(status.lastOkAt),
                count: status.count ?? 0,
              })}
            </p>
          ) : (
            <p className="text-muted">{t("pricelist.sheet.never")}</p>
          )}
          {status && !status.ok && status.reason && (
            <p className="text-danger">
              {t("pricelist.sheet.lastFail", {
                date: date(status.at),
                reason: reason(status.reason),
              })}
            </p>
          )}
        </div>
      )}
      {canEdit && (
        <div className="space-y-3">
          <Field label={t("pricelist.sheet.url")}>
            <div className="flex gap-2">
              <input
                className="input"
                value={url}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreview(null);
                }}
              />
              <button
                className="btn-secondary"
                disabled={check.busy || !url.trim()}
                onClick={() => void check.run().catch(() => {})}
              >
                {t("pricelist.sheet.check")}
              </button>
            </div>
          </Field>
          {p && !p.ok && <p className="text-sm text-danger">{reason(p.reason)}</p>}
          {p?.ok && (
            <div className="space-y-1 rounded-md border border-line p-3 text-sm">
              <p>
                {t("pricelist.sheet.preview", {
                  count: p.count,
                  current: p.current,
                  added: p.diff.added,
                  removed: p.diff.removed,
                  priceChanged: p.diff.priceChanged,
                  unchanged: p.diff.unchanged,
                })}
              </p>
              {p.jumped && <p className="font-medium text-warn">{t("pricelist.file.jumped")}</p>}
              {p.diff.samples.added.length > 0 && (
                <p className="text-muted">
                  {t("pricelist.sheet.sampleAdded", { names: p.diff.samples.added.join("; ") })}
                </p>
              )}
              {p.diff.samples.removed.length > 0 && (
                <p className="text-warn">
                  {t("pricelist.sheet.sampleRemoved", { names: p.diff.samples.removed.join("; ") })}
                </p>
              )}
              {p.diff.samples.priceChanged.length > 0 && (
                <ul className="list-disc pl-5 text-muted">
                  {p.diff.samples.priceChanged.map((c, i) => (
                    <li key={i}>
                      {t("pricelist.sheet.samplePrice", {
                        name: c.name,
                        from: money(c.from),
                        to: money(c.to),
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {p.errorCount > 0 && (
                <p className="text-warn">{t("pricelist.file.errors", { count: p.errorCount })}</p>
              )}
              <button
                className="btn-primary mt-2"
                disabled={load.busy}
                onClick={() => void load.run().catch(() => {})}
              >
                {t("pricelist.sheet.import")}
              </button>
            </div>
          )}
          {done !== null && (
            <p className="text-sm text-ok">{t("pricelist.sheet.imported", { count: done })}</p>
          )}
          {data.sheet && (
            <button
              className="btn-ghost text-xs text-danger"
              disabled={disconnect.busy}
              onClick={() => void disconnect.run().catch(() => {})}
            >
              {t("pricelist.sheet.disconnect")}
            </button>
          )}
          <p className="text-xs text-muted">{t("pricelist.sheet.fileNote")}</p>
        </div>
      )}
      <ErrorBox error={check.error ?? load.error ?? disconnect.error} />
    </Card>
  );
}
