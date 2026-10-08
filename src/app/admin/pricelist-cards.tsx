/**
 * Карточки страницы «Прайс консультанта» (BOVI): общие для обычной страницы
 * и рабочего места консультанта («Прайс», «База знаний», «Задачи», «Настройки бота»).
 */
import { useEffect, useState } from "react";
import {
  addKnowledgeArticlesFn,
  addProductMediaFn,
  clearConsultantTasksFn,
  consultantTasksFn,
  deleteProductMediaFn,
  disconnectPricelistSheetFn,
  importPricelistFn,
  importPricelistSheetFn,
  previewKnowledgeImportFn,
  previewPricelistSheetFn,
  markConsultantTaskFn,
  pricelistFn,
  refreshPricelistRateFn,
  savePricelistArticlesFn,
  savePricelistPersonaFn,
  savePricelistSettingsFn,
  setPricelistRateFn,
} from "./pricelist.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import { KNOWLEDGE_FILE_MAX_MB } from "@/core/consultant/pricelist/knowledge-import";

/** Выгрузка 1С бывает в UTF-8 и в Windows-1251: сначала строгий UTF-8, иначе 1251. */
export async function readCsv(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

export type Data = Awaited<ReturnType<typeof pricelistFn>>;
export type CardProps = { t: AdminT; data: Data; canEdit: boolean; onDone: () => Promise<void> };

export function FileCard({
  t,
  data,
  date,
  canEdit,
  onDone,
}: CardProps & { date: (s: string) => string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof importPricelistFn>> | null>(null);
  const upload = useAction(async (file: File) => {
    setResult(null);
    const csv = await readCsv(file);
    setResult(await importPricelistFn({ data: { csv, fileName: file.name } }));
    await onDone();
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
        <label className="btn-secondary mt-3 inline-block cursor-pointer">
          {t("pricelist.file.choose")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={upload.busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload.run(f).catch(() => {});
            }}
          />
        </label>
      )}
      {result && (
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
    r === "noRows" || r === "shrunk" || r === "changed"
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

export function RateCard({
  t,
  data,
  date,
  canEdit,
  onDone,
}: CardProps & { date: (s: string) => string }) {
  const [manual, setManual] = useState("");
  const [failed, setFailed] = useState(false);
  const refresh = useAction(async () => {
    const r = await refreshPricelistRateFn();
    setFailed(!r.fetched && r.error !== "manual");
    await onDone();
  });
  const save = useAction(async () => {
    await setPricelistRateFn({ data: { rate: Number(manual.replace(",", ".")) } });
    setManual("");
    await onDone();
  });
  const rate = data.rate;
  return (
    <Card title={t("pricelist.rate.title")}>
      {rate ? (
        <>
          <p className="text-lg font-semibold">
            {t("pricelist.rate.current", { rate: rate.rate })}{" "}
            {!rate.fresh && <Badge tone="warn">!</Badge>}
          </p>
          <p className="text-sm text-muted">
            {t("pricelist.rate.updated", { date: date(rate.updatedAt), source: rate.source })}
          </p>
          {!rate.fresh && <p className="mt-2 text-sm text-warn">{t("pricelist.rate.stale")}</p>}
        </>
      ) : (
        <p className="text-sm text-warn">{t("pricelist.rate.none")}</p>
      )}
      {failed && <p className="mt-2 text-sm text-warn">{t("pricelist.rate.failed")}</p>}
      {data.attempt && !data.attempt.ok && data.attempt.attempts.length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary>{t("pricelist.rate.lastAttempt", { date: date(data.attempt.at) })}</summary>
          <ul className="list-disc pl-5">
            {data.attempt.attempts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <div className="mt-3 space-y-3">
          {data.rateSource !== "manual" && (
            <button
              className="btn-secondary"
              disabled={refresh.busy}
              onClick={() => void refresh.run().catch(() => {})}
            >
              {t("pricelist.rate.refresh")}
            </button>
          )}
          <Field label={t("pricelist.rate.manual")} hint={t("pricelist.rate.manualHint")}>
            <div className="flex gap-2">
              <input
                className="input w-32"
                inputMode="decimal"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
              <button
                className="btn-secondary"
                disabled={save.busy || !manual.trim()}
                onClick={() => void save.run().catch(() => {})}
              >
                {t("pricelist.rate.setManual")}
              </button>
            </div>
          </Field>
        </div>
      )}
      <ErrorBox error={refresh.error ?? save.error} />
    </Card>
  );
}

export function SettingsCard({ t, data, canEdit, onDone }: CardProps) {
  const [synonyms, setSynonyms] = useState(data.synonyms);
  const [shopUrl, setShopUrl] = useState(data.shopUrl);
  const [store, setStore] = useState(data.store);
  const [followUp, setFollowUp] = useState(data.followUp);
  const [qualityDigest, setQualityDigest] = useState(data.qualityDigest);
  const [hours, setHours] = useState(data.hours);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await savePricelistSettingsFn({
      data: { synonyms, shopUrl, store, followUp, qualityDigest, hours },
    });
    setSaved(true);
    await onDone();
  });
  return (
    <Card title={t("pricelist.settings.title")}>
      <div className="space-y-3">
        <Field label={t("pricelist.settings.synonyms")} hint={t("pricelist.settings.synonymsHint")}>
          <textarea
            className="input min-h-32 font-mono text-xs"
            value={synonyms}
            disabled={!canEdit}
            onChange={(e) => setSynonyms(e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.settings.shopUrl")}>
          <input
            className="input"
            value={shopUrl}
            disabled={!canEdit}
            placeholder="https://"
            onChange={(e) => setShopUrl(e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.settings.address")}>
          <input
            className="input"
            value={store.address}
            disabled={!canEdit}
            onChange={(e) => setStore({ ...store, address: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pricelist.settings.phone")}>
            <input
              className="input"
              value={store.phone}
              disabled={!canEdit}
              onChange={(e) => setStore({ ...store, phone: e.target.value })}
            />
          </Field>
          <Field label={t("pricelist.settings.storeHours")}>
            <input
              className="input"
              value={store.hours}
              disabled={!canEdit}
              onChange={(e) => setStore({ ...store, hours: e.target.value })}
            />
          </Field>
        </div>
        <p className="label">{t("pricelist.settings.workHours")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pricelist.settings.open")}>
            <input
              className="input"
              inputMode="numeric"
              value={String(hours.open)}
              disabled={!canEdit}
              onChange={(e) => setHours({ ...hours, open: Number(e.target.value.trim()) })}
            />
          </Field>
          <Field label={t("pricelist.settings.close")}>
            <input
              className="input"
              inputMode="numeric"
              value={String(hours.close)}
              disabled={!canEdit}
              onChange={(e) => setHours({ ...hours, close: Number(e.target.value.trim()) })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">{t("pricelist.settings.workHoursHint")}</p>
        <p className="text-xs text-muted">
          {t("pricelist.hours", { open: hours.open, close: hours.close })}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={followUp}
            disabled={!canEdit}
            onChange={(e) => setFollowUp(e.target.checked)}
          />
          <span>
            {t("pricelist.settings.followUp")}
            <span className="block text-xs text-muted">{t("pricelist.settings.followUpHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={qualityDigest}
            disabled={!canEdit}
            onChange={(e) => setQualityDigest(e.target.checked)}
          />
          <span>
            {t("pricelist.settings.digest")}
            <span className="block text-xs text-muted">{t("pricelist.settings.digestHint")}</span>
          </span>
        </label>
        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              {t("pricelist.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("pricelist.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}

export function MediaCard({
  t,
  data,
  canEdit,
  onDone,
  showMatches = false,
}: CardProps & { showMatches?: boolean }) {
  const [match, setMatch] = useState("");
  const [color, setColor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const add = useAction(async () => {
    if (!file || !match.trim()) return;
    const { uploadFile } = await import("@/app/admin/upload-client");
    const key = await uploadFile("consultantMedia", file, t, (status) =>
      t("pricelist.uploadFailed", { status }),
    );
    await addProductMediaFn({
      data: { key, match, color: color || undefined, name: file.name },
    });
    setMatch("");
    setColor("");
    setFile(null);
    await onDone();
  });
  const remove = useAction(async (id: string) => {
    await deleteProductMediaFn({ data: { id } });
    await onDone();
  });
  return (
    <Card title={t("pricelist.media.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.media.hint")}</p>
      {data.media.length === 0 ? (
        <p className="text-sm">{t("pricelist.media.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.media.map((m) => (
            <li key={m.id} className="rounded-md border border-line p-2 text-xs">
              {m.kind === "video" ? (
                <div className="flex h-24 items-center justify-center bg-surface-2">
                  {t("pricelist.media.video")}
                </div>
              ) : (
                <img src={m.url} alt={m.match} className="h-24 w-full object-cover" />
              )}
              <div className="mt-1 font-medium">{m.match}</div>
              {m.color && <div className="text-muted">{m.color}</div>}
              {showMatches && (
                <div className={m.matches > 0 ? "text-ok" : "text-danger"}>
                  {m.matches > 0 ? t("ws.media.matches", { n: m.matches }) : t("ws.media.noMatch")}
                </div>
              )}
              {canEdit && (
                <button
                  className="btn-ghost mt-1 text-xs text-danger"
                  disabled={remove.busy}
                  onClick={() => void remove.run(m.id).catch(() => {})}
                >
                  {t("pricelist.delete")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("pricelist.media.match")}>
            <input
              className="input"
              value={match}
              placeholder="Uchino Zero Twist"
              onChange={(e) => setMatch(e.target.value)}
            />
          </Field>
          <Field label={t("pricelist.media.color")}>
            <input className="input" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label={t("pricelist.media.file")}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="flex items-end">
            <button
              className="btn-primary"
              disabled={add.busy || !file || !match.trim()}
              onClick={() => void add.run().catch(() => {})}
            >
              {t("pricelist.media.add")}
            </button>
          </div>
        </div>
      )}
      <ErrorBox error={add.error ?? remove.error} />
    </Card>
  );
}

export function KnowledgeCard({ t, data, canEdit, onDone }: CardProps) {
  // После загрузки статей список правки берётся из базы заново (новый ключ),
  // когда страница получила свежие статьи.
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  // Статьи, которые были на странице до загрузки: ждём, пока придут другие.
  const [staleArticles, setStaleArticles] = useState<Data["articles"] | null>(null);
  useEffect(() => {
    if (!staleArticles || data.articles === staleArticles) return;
    setStaleArticles(null);
    setDirty(false);
    setVersion((v) => v + 1);
  }, [data.articles, staleArticles]);
  return (
    <Card title={t("pricelist.kb.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.kb.hint")}</p>
      {canEdit && (
        <KnowledgeImport
          t={t}
          dirty={dirty}
          onDone={async () => {
            setStaleArticles(data.articles);
            await onDone();
          }}
        />
      )}
      <ArticlesEditor
        key={version}
        t={t}
        data={data}
        canEdit={canEdit}
        onDone={onDone}
        onDirty={setDirty}
      />
    </Card>
  );
}

export function ArticlesEditor({
  t,
  data,
  canEdit,
  onDone,
  onDirty,
}: CardProps & { onDirty: (dirty: boolean) => void }) {
  const [articles, setArticles] = useState(data.articles);
  useEffect(() => {
    onDirty(JSON.stringify(articles) !== JSON.stringify(data.articles));
  }, [articles, data.articles, onDirty]);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await savePricelistArticlesFn({ data: { articles } });
    setSaved(true);
    await onDone();
  });
  const set = (i: number, patch: Partial<(typeof articles)[number]>) =>
    setArticles((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <>
      <div className="space-y-3">
        {articles.map((a, i) => (
          <div key={a.id || i} className="rounded-md border border-line p-3">
            <Field label={t("pricelist.kb.articleTitle")}>
              <input
                className="input"
                value={a.title}
                disabled={!canEdit}
                onChange={(e) => set(i, { title: e.target.value })}
              />
            </Field>
            <Field label={t("pricelist.kb.content")}>
              <textarea
                className="input min-h-24 text-sm"
                value={a.content}
                disabled={!canEdit}
                onChange={(e) => set(i, { content: e.target.value })}
              />
            </Field>
            {canEdit && (
              <button
                className="btn-ghost text-xs text-danger"
                onClick={() => setArticles((as) => as.filter((_, j) => j !== i))}
              >
                {t("pricelist.delete")}
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <button
            className="btn-secondary"
            onClick={() =>
              setArticles((as) => [
                ...as,
                { id: "", title: "", tags: [], content: "", updatedAt: "" },
              ])
            }
          >
            {t("pricelist.kb.add")}
          </button>
          <button
            className="btn-primary"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("pricelist.save")}
          </button>
          {saved && <span className="text-sm text-ok">{t("pricelist.saved")}</span>}
        </div>
      )}
      <ErrorBox error={save.error} />
    </>
  );
}

export type KbPreview = Awaited<ReturnType<typeof previewKnowledgeImportFn>>;

export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read"));
    r.readAsDataURL(file);
  });
}

/**
 * Загрузка статей из PDF, Word, .txt/.md или вставленного текста: сначала
 * предпросмотр, в базу — только отмеченные; прежние статьи остаются.
 */
export function KnowledgeImport({
  t,
  dirty,
  onDone,
}: {
  t: AdminT;
  dirty: boolean;
  onDone: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<KbPreview | null>(null);
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [tooBig, setTooBig] = useState(false);
  const [done, setDone] = useState<{ added: number; updated: number; total: number } | null>(null);
  const show = (p: KbPreview) => {
    setPreview(p);
    setChosen(p.articles.map(() => true));
    setDone(null);
  };
  const fromFile = useAction(async (file: File) => {
    setPreview(null);
    setTooBig(file.size > KNOWLEDGE_FILE_MAX_MB * 1024 * 1024);
    if (file.size > KNOWLEDGE_FILE_MAX_MB * 1024 * 1024) return;
    const base64 = await fileBase64(file);
    show(await previewKnowledgeImportFn({ data: { fileName: file.name, base64 } }));
  });
  const fromText = useAction(async () => {
    setPreview(null);
    setTooBig(false);
    show(await previewKnowledgeImportFn({ data: { text } }));
  });
  const add = useAction(async () => {
    if (!preview) return;
    const articles = preview.articles
      .filter((_, i) => chosen[i])
      .map(({ title, tags, content }) => ({ title, tags, content }));
    const r = await addKnowledgeArticlesFn({ data: { articles } });
    setPreview(null);
    setText("");
    setDone(r);
    await onDone();
  });
  const count = chosen.filter(Boolean).length;
  return (
    <div className="mb-4 rounded-md border border-line p-3">
      <div className="mb-1 text-sm font-medium">{t("pricelist.kb.import.title")}</div>
      <p className="mb-3 text-xs text-muted">
        {t("pricelist.kb.import.hint", { mb: KNOWLEDGE_FILE_MAX_MB })}
      </p>
      <label className="btn-secondary inline-block cursor-pointer">
        {t("pricelist.kb.import.file")}
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          className="hidden"
          disabled={fromFile.busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void fromFile.run(f).catch(() => {});
          }}
        />
      </label>
      {tooBig && (
        <p className="mt-2 text-sm text-danger">
          {t("pricelist.kb.import.tooBig", { mb: KNOWLEDGE_FILE_MAX_MB })}
        </p>
      )}
      <Field label={t("pricelist.kb.import.text")}>
        <textarea
          className="input min-h-24 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <button
        className="btn-secondary"
        disabled={fromText.busy || !text.trim()}
        onClick={() => void fromText.run().catch(() => {})}
      >
        {t("pricelist.kb.import.preview")}
      </button>
      {preview && (
        <div className="mt-3 space-y-2 text-sm">
          <p>{t("pricelist.kb.import.found", { count: preview.articles.length })}</p>
          {preview.truncated > 0 && (
            <p className="text-warn">
              {t("pricelist.kb.import.truncated", {
                count: preview.truncated,
                max: preview.maxChars,
              })}
            </p>
          )}
          <ul className="space-y-2">
            {preview.articles.map((a, i) => (
              <li key={i} className="rounded-md border border-line p-2">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen[i] ?? false}
                    onChange={(e) =>
                      setChosen((c) => c.map((v, j) => (j === i ? e.target.checked : v)))
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{a.title}</span>{" "}
                    <Badge tone={a.replaces ? "warn" : "ok"}>
                      {a.replaces
                        ? t("pricelist.kb.import.replaces")
                        : t("pricelist.kb.import.new")}
                    </Badge>
                    {a.tags.length > 0 && (
                      <span className="block text-xs text-muted">#{a.tags.join(" #")}</span>
                    )}
                    <span className="block whitespace-pre-line text-xs text-muted">
                      {a.content.length > 300 ? `${a.content.slice(0, 300)}…` : a.content}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {dirty && <p className="text-warn">{t("pricelist.kb.import.saveFirst")}</p>}
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={add.busy || count === 0 || dirty}
              onClick={() => void add.run().catch(() => {})}
            >
              {t("pricelist.kb.import.add", { count })}
            </button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              {t("pricelist.kb.import.cancel")}
            </button>
          </div>
        </div>
      )}
      {done && <p className="mt-2 text-sm text-ok">{t("pricelist.kb.import.done", done)}</p>}
      <ErrorBox error={fromFile.error ?? fromText.error ?? add.error} />
    </div>
  );
}

/** Образ консультанта: название, о магазине, тон, особенности товаров. */
export function PersonaCard({ t, data, canEdit, onDone }: CardProps) {
  const [persona, setPersona] = useState(data.persona);
  const [custom, setCustom] = useState(data.personaCustom);
  const [saved, setSaved] = useState(false);
  const lim = data.personaLimits;
  const save = useAction(async (next: typeof persona | null) => {
    setSaved(false);
    const r = await savePricelistPersonaFn({ data: { persona: next } });
    setCustom(r.custom);
    setSaved(true);
    await onDone();
  });
  const set = (k: keyof typeof persona, v: string) => setPersona((p) => ({ ...p, [k]: v }));
  const left = (k: keyof typeof persona) => lim[k] - persona[k].length;
  return (
    <Card title={t("pricelist.persona.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.persona.hint")}</p>
      <div className="space-y-3">
        <Field label={t("pricelist.persona.brand")}>
          <input
            className="input"
            value={persona.brand}
            maxLength={lim.brand}
            disabled={!canEdit}
            onChange={(e) => set("brand", e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.persona.about")} hint={t("pricelist.persona.aboutHint")}>
          <textarea
            className="input min-h-16 text-sm"
            value={persona.about}
            maxLength={lim.about}
            disabled={!canEdit}
            onChange={(e) => set("about", e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.persona.tone")} hint={t("pricelist.persona.toneHint")}>
          <textarea
            className="input min-h-16 text-sm"
            value={persona.tone}
            maxLength={lim.tone}
            disabled={!canEdit}
            onChange={(e) => set("tone", e.target.value)}
          />
        </Field>
        <Field
          label={t("pricelist.persona.specialities")}
          hint={t("pricelist.persona.specialitiesHint")}
        >
          <textarea
            className="input min-h-32 text-sm"
            value={persona.specialities}
            maxLength={lim.specialities}
            disabled={!canEdit}
            onChange={(e) => set("specialities", e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">
          {t("pricelist.persona.left", { left: left("specialities") })}
        </p>
        <p className="text-sm text-muted">
          {custom ? t("pricelist.persona.custom") : t("pricelist.persona.default")}
        </p>
        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={save.busy || !persona.brand.trim()}
              onClick={() => void save.run(persona).catch(() => {})}
            >
              {t("pricelist.save")}
            </button>
            {custom && (
              <button
                className="btn-secondary"
                disabled={save.busy}
                onClick={() => void save.run(null).catch(() => {})}
              >
                {t("pricelist.persona.reset")}
              </button>
            )}
            {saved && <span className="text-sm text-ok">{t("pricelist.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}

/**
 * Задачи консультанта: каждая передача менеджеру. Список читается отдельным
 * вызовом — в нём имена и телефоны покупателей, и роли «просмотр» он закрыт.
 */
export function TasksCard({
  t,
  canEdit,
  date,
}: Omit<CardProps, "onDone"> & { date: (s: string) => string }) {
  type Tasks = Awaited<ReturnType<typeof consultantTasksFn>>;
  const [list, setList] = useState<Tasks | null>(null);
  const load = useAction(async () => setList(await consultantTasksFn()));
  useEffect(() => {
    if (canEdit) void load.run().catch(() => {});
    // Один раз при открытии страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);
  const mark = useAction(async (id: string, done: boolean) => {
    await markConsultantTaskFn({ data: { id, done } });
    await load.run();
  });
  const clear = useAction(async (which: "done" | "all") => {
    await clearConsultantTasksFn({ data: { which } });
    await load.run();
  });
  if (!canEdit) return null;
  const reason = (r: string) => {
    const key = `pricelist.tasks.reason.${r}` as AdminKey;
    return t(KNOWN_REASONS.includes(r) ? key : "pricelist.tasks.reason.other");
  };
  return (
    <Card title={t("pricelist.tasks.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.tasks.hint")}</p>
      {list && list.tasks.length === 0 && <p className="text-sm">{t("pricelist.tasks.empty")}</p>}
      {list && list.tasks.length > 0 && (
        <>
          <p className="mb-2 text-sm">{t("pricelist.tasks.open", { count: list.open })}</p>
          <ul className="space-y-2">
            {list.tasks.map((task) => (
              <li
                key={task.id}
                className={`rounded-md border border-line p-3 text-sm ${task.done ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={task.done ? "neutral" : "accent"}>{reason(task.reason)}</Badge>
                  {task.channel && (
                    <span className="text-xs text-muted">
                      {t(`pricelist.tasks.channel.${task.channel}` as AdminKey)}
                    </span>
                  )}
                  <span className="text-xs text-muted">{date(task.at)}</span>
                </div>
                <div className="mt-1 font-medium">{task.name ?? task.userKey}</div>
                {task.contact && <div className="text-muted">{task.contact}</div>}
                {task.text && <p className="mt-1 whitespace-pre-wrap">{task.text}</p>}
                {task.products && task.products.length > 0 && (
                  <>
                    <div className="mt-1 text-xs text-muted">{t("pricelist.tasks.products")}</div>
                    <ul className="list-disc pl-5 text-xs">
                      {task.products.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {task.link && (
                    <a
                      className="btn-ghost text-xs"
                      href={task.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("pricelist.tasks.openDialog")}
                    </a>
                  )}
                  <button
                    className="btn-secondary text-xs"
                    disabled={mark.busy}
                    onClick={() => void mark.run(task.id, !task.done).catch(() => {})}
                  >
                    {task.done ? t("pricelist.tasks.undo") : t("pricelist.tasks.done")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              disabled={clear.busy}
              onClick={() => void clear.run("done").catch(() => {})}
            >
              {t("pricelist.tasks.clearDone")}
            </button>
            <button
              className="btn-ghost text-danger"
              disabled={clear.busy}
              onClick={() => void clear.run("all").catch(() => {})}
            >
              {t("pricelist.tasks.clearAll")}
            </button>
          </div>
        </>
      )}
      <ErrorBox error={load.error ?? mark.error ?? clear.error} />
    </Card>
  );
}

/** Причины передачи, у которых есть своя подпись; остальное — «передача менеджеру». */
export const KNOWN_REASONS = [
  "purchase",
  "wholesale",
  "complaint",
  "human_requested",
  "photo",
  "unknown_question",
];
