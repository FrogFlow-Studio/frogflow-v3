import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  addProductMediaFn,
  deleteProductMediaFn,
  importPricelistFn,
  pricelistFn,
  refreshPricelistRateFn,
  savePricelistArticlesFn,
  savePricelistSettingsFn,
  setPricelistRateFn,
} from "@/app/admin/pricelist.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";

export const Route = createFileRoute("/admin/_authed/pricelist")({
  loader: () => pricelistFn(),
  component: PricelistPage,
});

/** Выгрузка 1С бывает в UTF-8 и в Windows-1251: сначала строгий UTF-8, иначе 1251. */
async function readCsv(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

function PricelistPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const canEdit = shop.role !== "viewer" && shop.role !== "accountant";
  const date = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageTitle title={t("pricelist.title")} subtitle={t("pricelist.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <FileCard t={t} data={data} date={date} canEdit={canEdit} onDone={router.invalidate} />
          <RateCard t={t} data={data} date={date} canEdit={canEdit} onDone={router.invalidate} />
          <SettingsCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
          <Card title={t("pricelist.usage.title")}>
            <p className="text-sm">
              {data.usage.messages
                ? t("pricelist.usage.summary", {
                    messages: data.usage.messages,
                    usd: data.usage.usd.toFixed(2),
                    per: data.usage.usdPerMessage.toFixed(4),
                    share: Math.round(data.usage.cacheReadShare * 100),
                  })
                : t("pricelist.usage.empty")}
            </p>
          </Card>
        </div>
        <div className="space-y-4">
          <MediaCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
          <KnowledgeCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
        </div>
      </div>
    </>
  );
}

type Data = Awaited<ReturnType<typeof pricelistFn>>;
type CardProps = { t: AdminT; data: Data; canEdit: boolean; onDone: () => Promise<void> };

function FileCard({ t, data, date, canEdit, onDone }: CardProps & { date: (s: string) => string }) {
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

function RateCard({ t, data, date, canEdit, onDone }: CardProps & { date: (s: string) => string }) {
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

function SettingsCard({ t, data, canEdit, onDone }: CardProps) {
  const [synonyms, setSynonyms] = useState(data.synonyms);
  const [shopUrl, setShopUrl] = useState(data.shopUrl);
  const [store, setStore] = useState(data.store);
  const [followUp, setFollowUp] = useState(data.followUp);
  const [qualityDigest, setQualityDigest] = useState(data.qualityDigest);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await savePricelistSettingsFn({ data: { synonyms, shopUrl, store, followUp, qualityDigest } });
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
        <p className="text-xs text-muted">
          {t("pricelist.hours", { open: data.hours.open, close: data.hours.close })}
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

function MediaCard({ t, data, canEdit, onDone }: CardProps) {
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

function KnowledgeCard({ t, data, canEdit, onDone }: CardProps) {
  const [articles, setArticles] = useState(data.articles);
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
    <Card title={t("pricelist.kb.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.kb.hint")}</p>
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
              setArticles((as) => [...as, { id: "", title: "", tags: [], content: "" }])
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
    </Card>
  );
}
