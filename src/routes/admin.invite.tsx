import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { acceptStaffInviteFn, staffInviteInfoFn } from "@/app/admin/team-invite.functions";
import { ADMIN_LOCALE_LABELS, adminT } from "@/app/i18n/admin";
import { ErrorBox, Field, ThemeToggle, useAction } from "@/app/ui";
import { isLocale, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/**
 * Страница ссылки-приглашения в команду магазина. Информация о ссылке
 * загружается на клиенте, а принятие — по кнопке: предпросмотр ссылки в
 * мессенджере открывает её GET-запросом и ничего не гасит.
 */
export const Route = createFileRoute("/admin/invite")({
  validateSearch: z.object({ b: z.string().optional(), t: z.string().optional() }),
  component: InvitePage,
});

function InvitePage() {
  const { b, t: token } = Route.useSearch();
  const [locale, setLocale] = useState<Locale>("ru");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ff-admin-locale");
      if (isLocale(saved)) setLocale(saved);
    } catch {
      /* без localStorage — русский */
    }
  }, []);
  const t = adminT(locale);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof staffInviteInfoFn>> | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!b || !token) return setInfo({ ok: false });
    staffInviteInfoFn({ data: { b, t: token } })
      .then(setInfo)
      .catch(() => setInfo({ ok: false }));
  }, [b, token]);
  const [stale, setStale] = useState(false);
  const accept = useAction(async (f: FormData) => {
    const r = await acceptStaffInviteFn({
      data: {
        b: b ?? "",
        t: token ?? "",
        username: String(f.get("username")),
        name: String(f.get("name") || "") || undefined,
        password: String(f.get("password")),
      },
    });
    if (r.ok) setDone(true);
    else setStale(true);
  });
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Link to="/" className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <div className="flex items-center gap-2">
          <select
            className="input h-8 text-xs"
            value={locale}
            aria-label={t("nav.language")}
            onChange={(e) => {
              const l = e.target.value as Locale;
              setLocale(l);
              try {
                localStorage.setItem("ff-admin-locale", l);
              } catch {
                /* ignore */
              }
            }}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {ADMIN_LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
          <ThemeToggle />
        </div>
      </header>
      <section className="mx-auto w-full max-w-sm flex-1 px-4 pt-6 pb-16 md:pt-16">
        <h1 className="text-2xl font-semibold">{t("staffInvite.title")}</h1>
        {done ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm">{t("staffInvite.done")}</p>
            <Link to="/admin/login" className="btn-primary w-full">
              {t("staffInvite.login")}
            </Link>
          </div>
        ) : info === null ? null : !info.ok || stale ? (
          <p className="mt-4 text-sm text-danger">{t("staffInvite.invalid")}</p>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              void accept.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <p className="text-sm text-muted">
              {t("staffInvite.intro", { shop: info.shop, role: t(`role.${info.role}`) })}
            </p>
            <Field label={t("staffInvite.username")} hint={t("settings.team.usernameHint")}>
              <input className="input" name="username" required autoComplete="username" />
            </Field>
            <Field label={t("staffInvite.name")}>
              <input className="input" name="name" maxLength={80} defaultValue={info.name ?? ""} />
            </Field>
            <Field label={t("staffInvite.password")} hint={t("staffInvite.passwordHint")}>
              <input
                className="input"
                name="password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
              />
            </Field>
            <ErrorBox error={accept.error} />
            <button className="btn-primary w-full" disabled={accept.busy}>
              {t("staffInvite.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
