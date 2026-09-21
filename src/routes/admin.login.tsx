import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { adminLogin } from "@/app/admin/admin.functions";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { ErrorBox, Field, ThemeToggle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/login")({
  loader: () => signupEnabledFn().catch(() => ({ enabled: false })),
  component: LoginPage,
});

/** Вход продавца в панель своего магазина. */
function LoginPage() {
  const { enabled: signup } = Route.useLoaderData();
  const navigate = useNavigate();
  const [wrong, setWrong] = useState(false);
  const { run, busy, error } = useAction(async (username: string, password: string) => {
    setWrong(false);
    const r = await adminLogin({ data: { username, password } });
    if (!r.ok) return setWrong(true);
    await navigate({ to: "/admin" });
  });
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Link to="/" className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <ThemeToggle />
      </header>
      <section className="mx-auto w-full max-w-sm flex-1 px-4 pt-6 pb-16 md:pt-16">
        <h1 className="text-2xl font-semibold">Вход в панель магазина</h1>
        <p className="mt-2 text-sm text-muted">
          Заказы, товары, покупатели, рассылки и аналитика вашего магазина. Введите логин и пароль,
          которые задали при регистрации.
        </p>
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(String(f.get("username")), String(f.get("password"))).catch(() => {});
          }}
          className="card mt-6 space-y-4 p-5"
        >
          <Field label="Логин">
            <input
              className="input"
              name="username"
              autoComplete="username"
              autoFocus
              required
              placeholder="логин магазина"
            />
          </Field>
          <Field label="Пароль">
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {wrong && (
            <p className="text-sm text-danger">
              Неверный логин или пароль. После нескольких неудачных попыток вход блокируется на 15
              минут.
            </p>
          )}
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
        <div className="mt-6 space-y-2 text-sm text-muted">
          {signup && (
            <p>
              Ещё нет магазина?{" "}
              <Link to="/signup" className="text-accent hover:underline">
                Зарегистрировать за пять минут
              </Link>
            </p>
          )}
          <p>Забыли пароль — напишите в поддержку FrogFlow, мы выдадим новый.</p>
        </div>
      </section>
    </main>
  );
}
