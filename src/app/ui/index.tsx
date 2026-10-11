import { Link, type LinkProps } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { claimStaleReload, isStaleChunkError, retryText, screenErrorText } from "@/lib/shown-error";
import { reportBrowserFailure } from "./report-client";

/* Маленькая библиотека компонентов платформы: без Radix, без зависимостей. */

export function Card({
  title,
  children,
  actions,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  help,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Рядом с подписью: в админке — «?» со статьёй «Помощи». */
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {help ? (
        <span className="label flex items-center gap-1.5">
          {label}
          {help}
        </span>
      ) : (
        <span className="label">{label}</span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
  children: ReactNode;
}) {
  const tones = {
    neutral: "",
    ok: "border-ok/30 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/15 text-fg",
    danger: "border-danger/30 bg-danger/10 text-danger",
    accent: "border-accent/30 bg-accent/10 text-accent",
  } as const;
  return <span className={`badge ${tones[tone]}`}>{children}</span>;
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

/**
 * Ошибка действия на экране. Сырой текст сбоя («Cannot read properties…»,
 * HTML страницы 500) человек не видит: только понятная фраза на языке
 * панели, а подробности — в Sentry (lib/shown-error).
 */
export function ErrorBox({ error }: { error: unknown }) {
  useEffect(() => {
    if (error) reportBrowserFailure(error);
  }, [error]);
  if (!error) return null;
  const lang = typeof document === "undefined" ? undefined : document.documentElement.lang;
  const text = screenErrorText(error, lang);
  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {text}
    </div>
  );
}

const staleDecision = new WeakMap<object, boolean>();

/** Решение «перезагрузить» принимается один раз на объект ошибки (повторный рендер не тратит минуту паузы). */
function reloadsForStaleChunk(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleChunkError(error)) return false;
  const key = error && typeof error === "object" ? error : null;
  const known = key ? staleDecision.get(key) : undefined;
  if (known !== undefined) return known;
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Хранилище закрыто (приватный режим): без отметки не перезагружаем.
  }
  const decision = claimStaleReload(storage);
  if (key) staleDecision.set(key, decision);
  return decision;
}

/**
 * Страница, у которой не загрузились данные (ошибка в loader/beforeLoad):
 * понятная фраза и кнопка «Обновить» вместо стандартного экрана с текстом
 * исключения. Подключена как defaultErrorComponent роутера.
 */
export function RouteError({ error }: { error: unknown }) {
  const reload = reloadsForStaleChunk(error);
  useEffect(() => {
    if (reload) window.location.reload();
  }, [reload]);
  const lang = typeof document === "undefined" ? undefined : document.documentElement.lang;
  // Старая сборка после выкладки: молча перезагружаемся, без ошибки на экране и в Sentry.
  if (reload) return <main className="min-h-[50vh]" />;
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-md flex-col justify-center gap-3 px-4">
      <ErrorBox error={error} />
      <button className="btn-secondary w-fit" onClick={() => window.location.reload()}>
        {retryText(lang)}
      </button>
    </main>
  );
}

export function NavLink(props: LinkProps & { children: ReactNode; className?: string }) {
  return (
    <Link
      {...props}
      className={`block rounded-md px-3 py-2 text-sm text-fg/80 hover:bg-surface-2 ${props.className ?? ""}`}
      activeProps={{ className: "bg-surface-2 font-medium text-fg" }}
    />
  );
}

/** Переключатель темы: класс .dark на <html>, выбор в localStorage. */
export function ThemeToggle({ labels }: { labels?: { light: string; dark: string } } = {}) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ff-theme");
      const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const on = saved ? saved === "dark" : prefers;
      setDark(on);
      document.documentElement.classList.toggle("dark", on);
    } catch {
      /* без localStorage — светлая */
    }
  }, []);
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      onClick={() => {
        const on = !dark;
        setDark(on);
        document.documentElement.classList.toggle("dark", on);
        try {
          localStorage.setItem("ff-theme", on ? "dark" : "light");
        } catch {
          /* ignore */
        }
      }}
    >
      {dark ? (labels?.light ?? "☀︎ Светлая") : (labels?.dark ?? "☾ Тёмная")}
    </button>
  );
}

export function Shell({
  brand,
  nav,
  user,
  children,
}: {
  brand: ReactNode;
  nav: ReactNode;
  user?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside
        className={`border-b border-line bg-surface md:min-h-screen md:border-r md:border-b-0 ${open ? "" : "max-md:hidden"} max-md:fixed max-md:inset-x-0 max-md:top-12 max-md:z-20`}
      >
        <div className="hidden h-12 items-center px-4 text-sm font-semibold md:flex">{brand}</div>
        <nav className="space-y-0.5 p-2" onClick={() => setOpen(false)}>
          {nav}
        </nav>
        <div className="mt-auto border-t border-line p-2 text-xs text-muted">{user}</div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
          <span className="text-sm font-semibold">{brand}</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setOpen((v) => !v)}
            aria-label="Меню"
          >
            ☰
          </button>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * Что панель ставит рядом с заголовком каждой страницы (в админке — «?»,
 * открывающий статью «Помощи» про эту страницу). Страницы об этом не знают.
 */
export const PageTitleAddon = createContext<ReactNode>(null);

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const addon = useContext(PageTitleAddon);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {addon}
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function useAction<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (...args: TArgs) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}
