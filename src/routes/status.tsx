import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { platformStatusFn } from "@/app/status/status.functions";
import { statusT } from "@/app/status/i18n";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import type { ServiceState } from "@/app/status/status";

const ICON: Record<ServiceState, string> = { ok: "✅", degraded: "⚠️", unknown: "⏳" };
const intl: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB", uz: "uz-UZ" };

/** Статус платформы для продавцов: без входа и без данных магазинов. */
export const Route = createFileRoute("/status")({
  validateSearch: z.object({ lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined) }),
  loader: () => platformStatusFn(),
  head: ({ match }) => ({ meta: [{ title: statusT(match.search.lang ?? "ru")("meta.title") }] }),
  component: StatusPage,
});

function StatusPage() {
  const s = Route.useLoaderData();
  const { lang } = Route.useSearch();
  const locale: Locale = lang ?? "ru";
  const t = statusT(locale);
  const date = (iso: string) => new Date(iso).toLocaleString(intl[locale]);
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <nav className="flex gap-2 text-sm">
          {SUPPORTED_LOCALES.map((l) => (
            <Link
              key={l}
              to="/status"
              search={{ lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <h1 className="mt-6 text-2xl font-semibold">
        {ICON[s.overall]} {t(`title.${s.overall}`)}
      </h1>
      <p className="mt-1 text-sm text-muted">{t("updated", { date: date(s.at) })}</p>
      <ul className="card mt-6 divide-y divide-line">
        {s.services.map((x) => (
          <li key={x.key} className="p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span>{t(`service.${x.key}` as "service.vip")}</span>
              <span>
                {ICON[x.state]} {t(`state.${x.state}`)}
              </span>
            </div>
            {x.lastFailAt && (
              <div className="mt-0.5 text-xs text-muted">
                {t("lastFail", { date: date(x.lastFailAt) })}
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">{t("note")}</p>
    </main>
  );
}
