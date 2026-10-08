import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { adminLogin, adminTgLoginRequest } from "@/app/admin/admin-auth.functions";
import { ADMIN_LOCALE_LABELS, adminT } from "@/app/i18n/admin";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { ErrorBox, Field, ThemeToggle, useAction } from "@/app/ui";
import { isLocale, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

export const Route = createFileRoute("/admin/login")({
  loader: () => signupEnabledFn().catch(() => ({ enabled: false })),
  component: LoginPage,
});

/** Язык страницы входа: сессии ещё нет, поэтому запоминается в браузере. */
function useLoginLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocale] = useState<Locale>("ru");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ff-admin-locale");
      if (isLocale(saved)) setLocale(saved);
    } catch {
      /* без localStorage — русский */
    }
  }, []);
  return [
    locale,
    (l) => {
      setLocale(l);
      try {
        localStorage.setItem("ff-admin-locale", l);
      } catch {
        /* ignore */
      }
    },
  ];
}

/** Вход продавца в панель своего магазина. */
function LoginPage() {
  const { enabled: signup } = Route.useLoaderData();
  const navigate = useNavigate();
  const [locale, setLocale] = useLoginLocale();
  const t = adminT(locale);
  const [wrong, setWrong] = useState(false);
  const { run, busy, error } = useAction(async (username: string, password: string) => {
    setWrong(false);
    const r = await adminLogin({ data: { username, password } });
    if (!r.ok) return setWrong(true);
    if (r.role === "operator" && "needCode" in r && r.needCode)
      return navigate({ to: "/operator/login" });
    await navigate({ to: r.role === "operator" ? "/operator" : "/admin" });
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
            onChange={(e) => setLocale(e.target.value as Locale)}
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
        <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("login.subtitle")}</p>
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(String(f.get("username")), String(f.get("password"))).catch(() => {});
          }}
          className="card mt-6 space-y-4 p-5"
        >
          <Field label={t("login.username")}>
            <input
              className="input"
              name="username"
              autoComplete="username"
              autoFocus
              required
              placeholder={t("login.usernamePlaceholder")}
            />
          </Field>
          <Field label={t("login.password")}>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {wrong && <p className="text-sm text-danger">{t("login.wrong")}</p>}
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? t("login.busy") : t("login.submit")}
          </button>
        </form>
        <TelegramLogin t={t} />
        <div className="mt-6 space-y-2 text-sm text-muted">
          {signup && (
            <p>
              {t("login.noShop")}{" "}
              <Link to="/signup" className="text-accent hover:underline">
                {t("login.signup")}
              </Link>
            </p>
          )}
          <p>{t("login.forgot")}</p>
        </div>
      </section>
    </main>
  );
}

/** Вход владельца по ссылке от бота магазина (app/auth/tg-login.server). */
function TelegramLogin({ t }: { t: ReturnType<typeof adminT> }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [limited, setLimited] = useState(false);
  const [username, setUsername] = useState("");
  const { run, busy, error } = useAction(async () => {
    const r = await adminTgLoginRequest({ data: { username } });
    setLimited("limited" in r);
    setSent(true);
  });
  if (!open)
    return (
      <button type="button" className="btn-secondary mt-3 w-full" onClick={() => setOpen(true)}>
        {t("login.tg.button")}
      </button>
    );
  return (
    <form
      className="card mt-3 space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run().catch(() => {});
      }}
    >
      <p className="text-sm text-muted">{t("login.tg.hint")}</p>
      <Field label={t("login.username")}>
        <input
          className="input"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setSent(false);
          }}
        />
      </Field>
      {sent && !limited && <p className="text-sm text-ok">{t("login.tg.sent")}</p>}
      {sent && limited && <p className="text-sm text-warn">{t("login.tg.limited")}</p>}
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy || !username.trim()}>
        {t("login.tg.send")}
      </button>
    </form>
  );
}
