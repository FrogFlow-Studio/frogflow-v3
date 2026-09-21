import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent } from "react";
import { signupEnabledFn, signupFn } from "@/app/signup/signup.functions";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { ErrorBox, Field, ThemeToggle, useAction } from "@/app/ui";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "FrogFlow · Регистрация" }] }),
  loader: () => signupEnabledFn(),
  component: SignupPage,
});

function SignupPage() {
  const { enabled } = Route.useLoaderData();
  const navigate = useNavigate();
  const { run, busy, error } = useAction(async (f: FormData) => {
    await signupFn({
      data: {
        name: String(f.get("name")),
        username: String(f.get("username")).trim().toLowerCase(),
        password: String(f.get("password")),
        vertical: String(f.get("vertical")),
        contact: String(f.get("contact") || "") || undefined,
        website: String(f.get("website") || ""),
      },
    });
    await navigate({ to: "/admin" });
  });
  if (!enabled) {
    return (
      <main className="mx-auto max-w-sm px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Регистрация закрыта</h1>
        <p className="mt-2 text-sm text-muted">
          Подключение магазинов сейчас идёт через оператора.
        </p>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Link to="/" className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <ThemeToggle />
      </header>
      <section className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-16 md:pt-12">
        <h1 className="text-2xl font-semibold">Открыть магазин</h1>
        <p className="mt-2 text-sm text-muted">
          Две минуты: название, логин и пароль. Бота в Telegram подключите следующим шагом — панель
          подскажет, что делать.
        </p>
        <form
          className="card mt-6 space-y-4 p-5"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            void run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <Field label="Название магазина">
            <input
              className="input"
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="Материалы для педагога"
            />
          </Field>
          <Field label="Что продаёте">
            <select className="input" name="vertical" defaultValue="digital">
              {VERTICAL_KEYS.filter((k) => !k.startsWith("consultant")).map((k) => (
                <option key={k} value={k}>
                  {VERTICALS[k].title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Логин" hint="Латиница и цифры. Станет адресом магазина: /s/<логин>.">
            <input
              className="input"
              name="username"
              required
              pattern="[a-z0-9][a-z0-9_.\-]{2,39}"
              autoComplete="username"
              placeholder="myshop"
            />
          </Field>
          <Field label="Пароль" hint="Не короче 8 символов.">
            <input
              className="input"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Как с вами связаться" hint="Телефон или @username, необязательно.">
            <input className="input" name="contact" maxLength={200} />
          </Field>
          <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            Создать магазин
          </button>
          <p className="text-center text-xs text-muted">
            Уже есть магазин?{" "}
            <Link to="/admin/login" className="text-accent hover:underline">
              Войти
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
