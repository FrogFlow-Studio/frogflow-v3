import { useEffect, useState } from "react";
import {
  catalogSheetFn,
  disconnectCatalogSheetFn,
  previewCatalogSheetFn,
  saveCatalogSheetFn,
} from "@/app/admin/catalog.functions";
import { type AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { type Preview } from "./import-card";

/** Синхронизация с Google-таблицей. */

type SheetInfo = Awaited<ReturnType<typeof catalogSheetFn>>;

type SheetRun = NonNullable<Awaited<ReturnType<typeof saveCatalogSheetFn>>>;

/**
 * Каталог из Google Таблицы: ссылка → предпросмотр → загрузка, дальше
 * обновление каждую ночь (core/catalog/sheet). Удалять таблица не умеет,
 * скрывает и перезаписывает ручные правки только по галочкам продавца.
 */
export function SheetCard({
  t,
  locale,
  onDone,
}: {
  t: AdminT;
  locale: string;
  onDone: () => Promise<void>;
}) {
  const [info, setInfo] = useState<SheetInfo | null>(null);
  const [url, setUrl] = useState("");
  const [hideMissing, setHideMissing] = useState(false);
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const reload = async () => {
    const r = await catalogSheetFn();
    setInfo(r);
    if (r.config) {
      setUrl(r.config.url);
      setHideMissing(r.config.hideMissing);
      setOverwriteManual(r.config.overwriteManual);
    }
  };
  useEffect(() => {
    void reload().catch(() => {});
  }, []);
  const reasonText = (r: string) => t(`sheet.reason.${r}` as Parameters<AdminT>[0]);
  const check = useAction(async () => {
    setPreview(null);
    const r = await previewCatalogSheetFn({ data: { url } });
    if (!r.ok) throw new Error(reasonText(r.reason));
    setPreview(r.preview);
  });
  const load = useAction(async () => {
    if (!preview) return;
    if (!confirm(t("sheet.confirm", { create: preview.create, update: preview.update }))) return;
    const r = await saveCatalogSheetFn({ data: { url, hideMissing, overwriteManual, run: true } });
    setPreview(null);
    await reload();
    await onDone();
    if (r && !r.ok) throw new Error(reasonText(r.reason));
  });
  const save = useAction(async () => {
    await saveCatalogSheetFn({ data: { url, hideMissing, overwriteManual, run: false } });
    await reload();
  });
  const disconnect = useAction(async () => {
    if (!confirm(t("sheet.disconnectConfirm"))) return;
    await disconnectCatalogSheetFn();
    setUrl("");
    setPreview(null);
    await reload();
  });
  const status = info?.status ?? null;
  const when = status ? new Date(status.at).toLocaleString(locale) : "";
  const connected = Boolean(info?.config);
  return (
    <Card title={t("sheet.title")} className="mb-4">
      <p className="mb-3 text-sm text-muted">{t("sheet.intro")}</p>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          aria-label={t("sheet.url")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
          }}
        />
        <button
          className="btn-secondary"
          disabled={!url.trim() || check.busy}
          onClick={() => void check.run().catch(() => {})}
        >
          {check.busy ? t("sheet.checking") : connected ? t("sheet.syncNow") : t("sheet.check")}
        </button>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={hideMissing}
          onChange={(e) => setHideMissing(e.target.checked)}
        />
        {t("sheet.hideMissing")}
      </label>
      <label className="mt-1 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={overwriteManual}
          onChange={(e) => setOverwriteManual(e.target.checked)}
        />
        {t("sheet.overwriteManual")}
      </label>
      <p className="mt-1 text-xs text-muted">{t("sheet.manualNote")}</p>
      <ErrorBox error={check.error ?? load.error ?? save.error ?? disconnect.error} />
      {preview && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {t("products.import.create")} <b>{preview.create}</b> · {t("products.import.update")}{" "}
            <b>{preview.update}</b>
            {preview.newCategories.length > 0 && (
              <>
                {" "}
                · {t("products.import.newCategories")} {preview.newCategories.join(", ")}
              </>
            )}
          </p>
          {preview.errors.length > 0 && (
            <ul className="max-h-32 overflow-auto text-xs text-danger">
              {preview.errors.map((e) => (
                <li key={e.line}>
                  {t("products.import.line", { line: e.line, message: e.message })}
                </li>
              ))}
            </ul>
          )}
          <button
            className="btn-primary"
            disabled={!preview.ok || load.busy}
            onClick={() => void load.run().catch(() => {})}
          >
            {load.busy ? t("products.import.applying") : t("sheet.connect")}
          </button>
        </div>
      )}
      {connected && (
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <p className="break-all text-xs text-muted">
            {t("sheet.connected")} {info!.config!.url}
          </p>
          {status && <SheetStatusLine t={t} status={status} when={when} reason={reasonText} />}
          <div className="flex gap-2 pt-1">
            <button
              className="btn-secondary text-sm"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              {t("sheet.save")}
            </button>
            <button
              className="btn-ghost text-sm"
              disabled={disconnect.busy}
              onClick={() => void disconnect.run().catch(() => {})}
            >
              {t("sheet.disconnect")}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SheetStatusLine({
  t,
  status,
  when,
  reason,
}: {
  t: AdminT;
  status: SheetRun & { at: string };
  when: string;
  reason: (r: string) => string;
}) {
  if (!status.ok)
    return (
      <p className="text-danger">{t("sheet.lastFail", { when, reason: reason(status.reason) })}</p>
    );
  return (
    <>
      <p>
        {t("sheet.lastOk", {
          when,
          created: status.created,
          updated: status.updated,
          hidden: status.hidden,
        })}
      </p>
      {status.kept > 0 && (
        <p className="text-xs text-muted">{t("sheet.kept", { n: status.kept })}</p>
      )}
      {status.needsReview > 0 && (
        <p className="text-xs text-muted">{t("sheet.needsReview", { n: status.needsReview })}</p>
      )}
      {status.skippedDeleted > 0 && (
        <p className="text-xs text-muted">
          {t("sheet.skippedDeleted", { n: status.skippedDeleted })}
        </p>
      )}
      {status.guard && <p className="text-xs text-danger">{t("sheet.guard")}</p>}
      {status.errors.length > 0 && (
        <ul className="max-h-24 overflow-auto text-xs text-danger">
          {status.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </>
  );
}
