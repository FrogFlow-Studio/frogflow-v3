import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent } from "react";
import { signupEnabledFn, signupFn } from "@/app/signup/signup.functions";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { ErrorBox, Field, useAction } from "@/app/ui";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">Открыть магазин</h1>
      <p className="mt-2 text-sm text-muted">
        Две минуты: название и логин. Бота в Telegram подключите следующим шагом, в настройках.
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
    </main>
  );
}
