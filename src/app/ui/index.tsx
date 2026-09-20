import { Link, type LinkProps } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

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
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
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

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const text = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {text}
    </div>
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
export function ThemeToggle() {
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
      {dark ? "☀︎ Светлая" : "☾ Тёмная"}
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

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
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
