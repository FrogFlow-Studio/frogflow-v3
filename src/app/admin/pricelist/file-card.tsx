import { useState } from "react";
import { importPricelistDriveFn, importPricelistFn } from "../pricelist.functions";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { type AdminT } from "@/app/i18n/admin";
import { type CardProps, type ImportResult, type Pending, rawBase64, readCsv } from "./shared";

/** Загрузка прайса файлом. */

export function FileCard({
  t,
  data,
  date,
  canEdit,
  onDone,
}: CardProps & { date: (s: string) => string }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [driveUrl, setDriveUrl] = useState("");
  const send = async (what: Pending, confirm: boolean) => {
    if (what.kind === "drive") return importPricelistDriveFn({ data: { url: what.url, confirm } });
    const xlsx = /\.xlsx$/i.test(what.file.name);
    return importPricelistFn({
      data: xlsx
        ? { xlsx: await rawBase64(what.file), fileName: what.file.name, confirm }
        : { csv: await readCsv(what.file), fileName: what.file.name, confirm },
    });
  };
  const upload = useAction(async (what: Pending, confirm?: boolean) => {
    setResult(null);
    setPending(null);
    const r = await send(what, confirm ?? false);
    setResult(r);
    if (r.needsConfirm) setPending(what);
    else await onDone();
  });
  return (
    <Card title={t("pricelist.file.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.file.hint")}</p>
      {data.meta ? (
        <p className="text-sm">
          {t("pricelist.file.meta", {
            count: data.count,
            date: date(data.meta.importedAt),
            source: data.meta.source,
          })}
        </p>
      ) : data.count > 0 ? (
        // Прайс из v1 без записи о загрузке: позиции есть, даты нет.
        <p className="text-sm">{t("pricelist.file.loaded", { count: data.count })}</p>
      ) : (
        <p className="text-sm">{t("pricelist.file.none")}</p>
      )}
      {data.hidden > 0 && (
        <p className="mt-1 text-sm text-muted">
          {t("pricelist.file.hidden", { count: data.hidden })}
        </p>
      )}
      {canEdit && (
        <>
          <label className="btn-secondary mt-3 inline-block cursor-pointer">
            {t("pricelist.file.choose")}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={upload.busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload.run({ kind: "file", file: f }).catch(() => {});
              }}
            />
          </label>
          <div className="mt-3">
            <Field label={t("pricelist.file.driveLabel")} hint={t("pricelist.file.driveHint")}>
              <div className="flex flex-wrap gap-2">
                <input
                  className="input min-w-0 flex-1"
                  value={driveUrl}
                  placeholder="https://drive.google.com/file/d/…"
                  onChange={(e) => setDriveUrl(e.target.value)}
                />
                <button
                  className="btn-secondary"
                  disabled={upload.busy || driveUrl.trim().length < 8}
                  onClick={() =>
                    void upload.run({ kind: "drive", url: driveUrl.trim() }).catch(() => {})
                  }
                >
                  {t("pricelist.file.driveLoad")}
                </button>
              </div>
            </Field>
          </div>
        </>
      )}
      {result?.needsConfirm && pending && (
        <div className="mt-3 space-y-1 rounded-md border border-warn/40 bg-warn/15 p-3 text-sm">
          <p className="font-medium">{t("pricelist.file.jumped")}</p>
          <p>
            {t("pricelist.file.diff", {
              added: result.diff.added,
              removed: result.diff.removed,
              priceChanged: result.diff.priceChanged,
            })}
          </p>
          <PriceSamples t={t} samples={result.diff.samples.priceChanged} />
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              className="btn-primary text-sm"
              disabled={upload.busy}
              onClick={() => void upload.run(pending, true).catch(() => {})}
            >
              {t("pricelist.file.confirm")}
            </button>
            <button
              className="btn-ghost text-sm"
              onClick={() => {
                setPending(null);
                setResult(null);
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      {result && !result.needsConfirm && (
        <div className="mt-3 text-sm">
          <p>{t("pricelist.file.loaded", { count: result.meta.count })}</p>
          <p className="text-muted">
            {t("pricelist.file.diff", {
              added: result.diff.added,
              removed: result.diff.removed,
              priceChanged: result.diff.priceChanged,
            })}
          </p>
          {result.sheetDisconnected && <p className="text-warn">{t("pricelist.file.sheetOff")}</p>}
          {result.errorCount > 0 && (
            <>
              <p className="mt-1 text-warn">
                {t("pricelist.file.errors", { count: result.errorCount })}
              </p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {result.errors.map((e) => (
                  <li key={e.row}>{t("pricelist.file.row", { row: e.row, message: e.message })}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <ErrorBox error={upload.error} />
    </Card>
  );
}

/** Примеры смены цены: «Название: 21 000 → 210 000». */
function PriceSamples({
  t,
  samples,
}: {
  t: AdminT;
  samples: Array<{ name: string; from: number; to: number }>;
}) {
  if (!samples.length) return null;
  const money = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  return (
    <ul className="list-disc pl-5 text-muted">
      {samples.map((c, i) => (
        <li key={i}>
          {t("pricelist.sheet.samplePrice", { name: c.name, from: money(c.from), to: money(c.to) })}
        </li>
      ))}
    </ul>
  );
}
