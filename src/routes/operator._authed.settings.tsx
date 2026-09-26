import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  operatorCredentialsFn,
  payoutRequisitesFn,
  sendTestErrorFn,
  setOperatorCredentialsFn,
  setPayoutRequisitesFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/settings")({
  loader: async () => {
    const [cred, payout] = await Promise.all([operatorCredentialsFn(), payoutRequisitesFn()]);
    return { ...cred, requisites: payout.requisites };
  },
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
        <RequisitesCard requisites={cred.requisites} />
        <ErrorTrackingCard />
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

function RequisitesCard({ requisites }: { requisites: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (value: string) => {
    await setPayoutRequisitesFn({ data: { requisites: value } });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <Card title="Реквизиты для выплат">
      <p className="mb-3 text-sm text-muted">
        Подставляются в счёт владельцу бота (карточка клиента → «Подписка и счета»). Снимок
        реквизитов хранится в каждом счёте — смена реквизитов не меняет уже выставленные.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save
            .run(String(new FormData(e.currentTarget).get("requisites") ?? ""))
            .catch(() => {});
        }}
      >
        <textarea
          className="input"
          name="requisites"
          rows={4}
          defaultValue={requisites}
          placeholder="Kaspi Gold 4400 …, получатель …"
        />
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            Сохранить
          </button>
          {saved && <span className="text-sm text-ok">Сохранено</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

/** Учёт ошибок (src/lib/errors.ts): пробное событие в Sentry по кнопке. */
function ErrorTrackingCard() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendTestErrorFn>> | null>(null);
  const test = useAction(async () => setResult(await sendTestErrorFn()));
  return (
    <Card title="Учёт ошибок (Sentry)">
      <p className="mb-3 text-sm text-muted">
        Сбои вебхуков, кронов и сервера уходят в Sentry с клиентом и местом. Кнопка шлёт пробное
        событие «Проверка учёта ошибок» — покупателей и клиентов оно не касается.
      </p>
      <div className="flex items-center gap-3">
        <button
          className="btn-secondary"
          disabled={test.busy}
          onClick={() => void test.run().catch(() => {})}
        >
          Отправить пробную ошибку
        </button>
        {result &&
          (result.ok ? (
            <Badge tone="ok">принято, id {result.eventId.slice(0, 8)}</Badge>
          ) : (
            <Badge tone="danger">{result.reason}</Badge>
          ))}
      </div>
      <ErrorBox error={test.error} />
    </Card>
  );
}
