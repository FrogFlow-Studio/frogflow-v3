import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { operatorLogin } from "@/app/operator/operator.functions";
import { ErrorBox, Field, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const [wrong, setWrong] = useState(false);
  const { run, busy, error } = useAction(async (username: string, password: string) => {
    const r = await operatorLogin({ data: { username, password } });
    if (!r.ok) return setWrong(true);
    await navigate({ to: "/operator" });
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(String(f.get("username")), String(f.get("password"))).catch(() => {});
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-lg font-semibold">Панель оператора</h1>
      <p className="mt-1 text-sm text-muted">Управление клиентами платформы FrogFlow.</p>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        <Field label="Логин">
          <input className="input" name="username" autoComplete="username" required />
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
        {wrong && <p className="text-sm text-danger">Неверный логин или пароль.</p>}
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy}>
          Войти
        </button>
      </form>
    </main>
  );
}
