import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { reportT, type ReportKey } from "@/app/market/report-i18n";
import { reportFormFn, submitReportFn } from "@/app/market/report.functions";
import { solveChallenge } from "@/app/signup/challenge-solve";
import { ErrorBox, Field, useAction } from "@/app/ui";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { REPORT_REASONS } from "@/core/marketplace/report";

/**
 * Жалоба на магазин или товар с площадки (В11). Публичная, без входа; жалоба уходит оператору,
 * магазин её не видит. Страница не для поиска: noindex.
 */
export const Route = createFileRoute("/market/report")({
  validateSearch: z.object({
    lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined),
    shop: z.string().max(80).optional().catch(undefined),
    product: z.string().max(40).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ shop: search.shop, product: search.product }),
  loader: ({ deps }) => reportFormFn({ data: { slug: deps.shop ?? "", product: deps.product } }),
  head: ({ match }) => ({
    meta: [
      { title: reportT(match.search.lang ?? "ru")("meta.title") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportPage,
});

/** Номер устройства: случайный, хранится в браузере; на сервер уходит и там хешируется. */
function deviceId(): string {
  try {
    const key = "ff_report_device";
    let v = localStorage.getItem(key);
    if (!v || !/^[0-9a-f]{32}$/.test(v)) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return "";
  }
}

function ReportPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const locale: Locale = search.lang ?? "ru";
  const t = reportT(locale);
  const [done, setDone] = useState(false);
  const [refusal, setRefusal] = useState<ReportKey | null>(null);
  const { run, busy, error } = useAction(async (f: FormData) => {
    setRefusal(null);
    const answer = await solveChallenge(data.challenge);
    const r = await submitReportFn({
      data: {
        slug: search.shop ?? "",
        productId: search.product ?? "",
        reason: String(f.get("reason") ?? "other") as (typeof REPORT_REASONS)[number],
        text: String(f.get("text") ?? ""),
        device: deviceId(),
        website: String(f.get("website") ?? ""),
        challenge: data.challenge,
        answer,
      },
    });
    if (r.ok) setDone(true);
    else setRefusal(`err.${r.error}` as ReportKey);
  });
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/market"
          search={search.lang ? { lang: search.lang } : {}}
          className="text-lg font-semibold"
        >
          🐸 FrogFlow
        </Link>
        <nav className="flex gap-2 text-sm">
          {SUPPORTED_LOCALES.map((l) => (
            <Link
              key={l}
              to="/market/report"
              search={{ ...search, lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      {data.shop == null ? (
        <div className="card mt-6 p-5">
          <h1 className="font-medium">{t("missing.title")}</h1>
          <p className="mt-2 text-sm text-muted">{t("missing.text")}</p>
          <Link
            to="/market"
            search={search.lang ? { lang: search.lang } : {}}
            className="mt-3 inline-block text-sm underline"
          >
            {t("back")}
          </Link>
        </div>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm font-medium">
            {data.product
              ? t("about.product", { shop: data.shop, product: data.product })
              : t("about.shop", { shop: data.shop })}
          </p>
          {done ? (
            <div className="card mt-6 p-5" role="status">
              <h2 className="font-medium">{t("done.title")}</h2>
              <p className="mt-2 text-sm text-muted">{t("done.text")}</p>
              <Link
                to="/market/rules"
                search={search.lang ? { lang: search.lang } : {}}
                hash="s7"
                className="mt-3 inline-block text-sm underline"
              >
                {t("rules.link")}
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">{t("lead")}</p>
              <p className="mt-1 text-sm">
                <Link
                  to="/market/rules"
                  search={search.lang ? { lang: search.lang } : {}}
                  hash="s7"
                  className="underline"
                >
                  {t("rules.link")}
                </Link>
              </p>
              <form
                className="card mt-6 space-y-5 p-5"
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  void run(new FormData(e.currentTarget)).catch(() => {});
                }}
              >
                <fieldset className="space-y-2">
                  <legend className="font-medium">{t("field.reason")}</legend>
                  {REPORT_REASONS.map((k, i) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="reason"
                        value={k}
                        defaultChecked={i === 0}
                        required
                      />
                      {t(`reason.${k}` as ReportKey)}
                    </label>
                  ))}
                </fieldset>
                <Field label={t("field.text")}>
                  <textarea className="input" name="text" rows={4} maxLength={1000} />
                </Field>
                <p className="text-xs text-muted">{t("text.hint")}</p>
                <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
                {refusal && (
                  <p className="text-sm text-danger" role="alert">
                    {t(refusal)}
                  </p>
                )}
                <ErrorBox error={error ? new Error(t("err.failed")) : null} />
                <button className="btn-primary w-full" disabled={busy}>
                  {t("submit")}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </main>
  );
}
