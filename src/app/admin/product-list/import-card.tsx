import { HelpTip } from "@/app/admin/help-panel";
import { useState } from "react";
import { importCatalogFn } from "@/app/admin/catalog.functions";
import { type AdminT } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";

/** Импорт товаров из файла. */

export type Preview = NonNullable<Awaited<ReturnType<typeof importCatalogFn>>["preview"]>;

type Result = NonNullable<Awaited<ReturnType<typeof importCatalogFn>>["result"]>;

/**
 * Импорт из CSV (Excel → «Сохранить как CSV»): сначала предпросмотр — что
 * создастся, что обновится, какие колонки не поняты, — потом применение.
 * Выгрузка отдаёт тот же формат с id, чтобы правки в Excel возвращались.
 */
export function ImportCard({ t, onDone }: { t: AdminT; onDone: () => Promise<void> }) {
  const [payload, setPayload] = useState<{ csv: string } | { xlsx: string }>({ csv: "" });
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const load = useAction(async (file: File) => {
    // Excel уходит как есть (base64) и читается на сервере, CSV — текстом.
    let next: { csv: string } | { xlsx: string };
    if (/\.xlsx$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      next = { xlsx: btoa(bin) };
    } else next = { csv: await file.text() };
    setFileName(file.name);
    setPayload(next);
    setResult(null);
    const r = await importCatalogFn({ data: { ...next, apply: false } });
    setPreview(r.preview);
  });
  const apply = useAction(async () => {
    if (!preview) return;
    if (!confirm(t("products.import.confirm", { create: preview.create, update: preview.update })))
      return;
    const r = await importCatalogFn({ data: { ...payload, apply: true } });
    setResult(r.result);
    setPreview(null);
    await onDone();
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("products.import.title")}
          <HelpTip article="products" anchor="import" />
        </span>
      }
      className="mb-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm text-muted">{t("products.import.intro22")}</p>
          <a className="btn-secondary inline-block" href="/api/admin/export/products">
            {t("products.import.download")}
          </a>
        </div>
        <div>
          <label className="btn-secondary inline-block cursor-pointer">
            {load.busy
              ? t("products.import.reading")
              : fileName
                ? t("products.import.file", { name: fileName })
                : t("products.import.choose22")}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void load.run(f).catch(() => {});
                e.target.value = "";
              }}
            />
          </label>
          <ErrorBox error={load.error ?? apply.error} />
          {preview && (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                {t("products.import.create")} <b>{preview.create}</b> ·{" "}
                {t("products.import.update")} <b>{preview.update}</b>
                {preview.newCategories.length > 0 && (
                  <>
                    {" "}
                    · {t("products.import.newCategories")} {preview.newCategories.join(", ")}
                  </>
                )}
              </p>
              {preview.withPhotos > 0 && (
                <p className="text-xs text-muted">
                  {t("products.import.withPhotos", { n: preview.withPhotos })}
                </p>
              )}
              {preview.unknownColumns.length > 0 && (
                <p className="text-xs text-muted">
                  {t("products.import.unknown", { cols: preview.unknownColumns.join(", ") })}
                </p>
              )}
              {preview.errors.length > 0 && (
                <ul className="max-h-32 overflow-auto text-xs text-danger">
                  {preview.errors.map((e, i) => (
                    <li key={`${e.line}-${i}`}>
                      {t("products.import.line", { line: e.line, message: e.message })}
                    </li>
                  ))}
                </ul>
              )}
              {preview.warnings.length > 0 && (
                <div className="text-xs text-muted">
                  <p>{t("products.import.warningsTitle")}</p>
                  <ul className="max-h-24 overflow-auto">
                    {preview.warnings.map((w, i) => (
                      <li key={`${w.line}-${i}`}>
                        {t("products.import.line", { line: w.line, message: w.message })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.samples.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-md border border-line p-2 text-xs">
                  {preview.samples.map((x, i) => (
                    <li key={i}>
                      <Badge tone={x.action === "create" ? "accent" : "neutral"}>
                        {x.action === "create"
                          ? t("products.import.rowNew")
                          : t("products.import.rowUpdate")}
                      </Badge>{" "}
                      {x.name}
                      {x.price !== null && ` — ${x.price}`}
                      {x.category && <span className="text-muted"> · {x.category}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="btn-primary"
                disabled={!preview.ok || apply.busy}
                onClick={() => void apply.run().catch(() => {})}
              >
                {apply.busy ? t("products.import.applying") : t("products.import.apply")}
              </button>
            </div>
          )}
          {result && (
            <div className="mt-3 text-sm">
              <p>
                {t("products.import.done", { created: result.created, updated: result.updated })}
                {result.categoriesCreated > 0 &&
                  t("products.import.doneCategories", { n: result.categoriesCreated })}
                .
                {result.photosAdded > 0 &&
                  ` ${t("products.import.photosDone", { n: result.photosAdded })}.`}
              </p>
              {result.warnings.length > 0 && (
                <div className="mt-1 text-xs text-muted">
                  <p>{t("products.import.warningsTitle")}</p>
                  <ul className="max-h-24 overflow-auto">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.errors.length > 0 && (
                <ul className="mt-1 max-h-32 overflow-auto text-xs text-danger">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
