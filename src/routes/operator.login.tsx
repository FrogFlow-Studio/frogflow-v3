import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { operatorLogin } from "@/app/operator/operator-auth.functions";
import { ErrorBox, Field, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const [wrong, setWrong] = useState(false);
  // Двухшаговый вход: после верного пароля — поле для кода.
  const [needCode, setNeedCode] = useState(false);
  const [badCode, setBadCode] = useState(false);
  const { run, busy, error } = useAction(
    async (username: string, password: string, code: string) => {
      setWrong(false);
      setBadCode(false);
      const r = await operatorLogin({ data: { username, password, code: code || undefined } });
      if (!r.ok) {
        if ("needCode" in r && r.needCode) {
          setNeedCode(true);
          setBadCode(r.badCode);
          return;
        }
        return setWrong(true);
      }
      await navigate({ to: "/operator" });
    },
  );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(
      String(f.get("username")),
      String(f.get("password")),
      String(f.get("code") ?? "").trim(),
    ).catch(() => {});
  };
  return (
    <main className="operator-workspace operator-login-screen">
      <div className="operator-login-panel">
        <div className="operator-login-brand">🐸 FrogFlow</div>
        <h1 className="text-lg font-semibold">Панель оператора</h1>
        <p className="mt-1 text-sm text-muted">Управление клиентами платформы FrogFlow.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
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
          {needCode && (
            <Field
              label="Код из приложения"
              hint="6 цифр из приложения-аутентификатора или резервный код"
            >
              <input
                className="input"
                name="code"
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </Field>
          )}
          {wrong && (
            <p className="text-sm text-danger" role="alert">
              Неверный логин или пароль.
            </p>
          )}
          {badCode && (
            <p className="text-sm text-danger" role="alert">
              Код не подошёл. Введите новый код.
            </p>
          )}
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
      </div>
    </main>
  );
}
