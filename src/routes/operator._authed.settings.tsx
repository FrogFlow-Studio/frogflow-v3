import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { operatorCredentialsFn, setOperatorCredentialsFn } from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/settings")({
  loader: () => operatorCredentialsFn(),
  component: SettingsPage,
});

function SettingsPage() {
  const cred = Route.useLoaderData();
  const router = useRouter();
  const [done, setDone] = useState(false);
  const save = useAction(async (f: FormData) => {
    const password = String(f.get("password"));
    if (password !== String(f.get("password2"))) throw new Error("Пароли не совпадают.");
    await setOperatorCredentialsFn({
      data: {
        currentPassword: String(f.get("currentPassword")),
        username: String(f.get("username")),
        password,
      },
    });
    await router.invalidate();
    setDone(true);
  });
  return (
    <>
      <PageTitle title="Настройки платформы" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Учётка оператора">
          <p className="mb-3 text-sm text-muted">
            Логин и пароль хранятся в базе, а не в переменных деплоя. Ими вы входите с главной
            страницы через общую форму «Войти».
          </p>
          <p className="mb-4 text-sm">
            Сейчас: <span className="font-mono">{cred.username ?? "—"}</span>{" "}
            {cred.source === "database" ? (
              <Badge tone="ok">в базе</Badge>
            ) : cred.source === "environment" ? (
              <Badge tone="warn">запасной вход из переменных деплоя</Badge>
            ) : (
              <Badge tone="danger">не задана</Badge>
            )}
          </p>
          {cred.source === "environment" && (
            <p className="mb-4 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
              Задайте логин и пароль здесь — после этого переменные OPERATOR_USERNAME и
              OPERATOR_PASSWORD в Vercel можно удалить.
            </p>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setDone(false);
              const form = e.currentTarget;
              void save
                .run(new FormData(form))
                .then(() => form.reset())
                .catch(() => {});
            }}
          >
            <Field label="Текущий пароль">
              <input
                className="input"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <Field label="Новый логин" hint="Латиница, цифры, точка, дефис, подчёркивание.">
              <input
                className="input"
                name="username"
                defaultValue={cred.username ?? ""}
                required
                minLength={3}
                maxLength={40}
                autoComplete="username"
              />
            </Field>
            <Field label="Новый пароль" hint="Не короче 10 символов.">
              <input
                className="input"
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Ещё раз новый пароль">
              <input
                className="input"
                name="password2"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </Field>
            <button className="btn-primary" disabled={save.busy}>
              Сохранить
            </button>
            {done && (
              <span className="ml-3 text-sm text-ok">Сохранено — входите с новыми данными.</span>
            )}
          </form>
          <ErrorBox error={save.error} />
        </Card>
      </div>
    </>
  );
}
