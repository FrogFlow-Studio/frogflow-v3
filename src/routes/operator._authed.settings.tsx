import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  operatorCredentialsFn,
  payoutRequisitesFn,
  sendTestErrorFn,
  setOperatorCredentialsFn,
  setPayoutRequisitesFn,
  twoFactorStatusFn,
  startTwoFactorFn,
  confirmTwoFactorFn,
  disableTwoFactorFn,
  regenerateBackupCodesFn,
  alertChannelStatusFn,
  saveAlertChannelFn,
  clearAlertChannelFn,
  testAlertChannelFn,
  v2WebhookStatusFn,
  syncV2WebhookFn,
  aiMarkupFn,
  setAiMarkupFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { shownError } from "@/lib/shown-error";

export const Route = createFileRoute("/operator/_authed/settings")({
  loader: async () => {
    const [cred, payout, twoFactor, alerts, aiMarkup] = await Promise.all([
      operatorCredentialsFn(),
      payoutRequisitesFn(),
      twoFactorStatusFn(),
      alertChannelStatusFn(),
      aiMarkupFn(),
    ]);
    return {
      ...cred,
      aiMarkup: aiMarkup.percent,
      twoFactor,
      alerts,
      requisites: payout.requisites,
      recipient: payout.recipient,
      kaspiLink: payout.kaspiLink,
    };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const cred = Route.useLoaderData();
  const router = useRouter();
  const [done, setDone] = useState(false);
  const save = useAction(async (f: FormData) => {
    const password = String(f.get("password"));
    if (password !== String(f.get("password2"))) throw shownError("Пароли не совпадают.");
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
        <RequisitesCard
          requisites={cred.requisites}
          recipient={cred.recipient}
          kaspiLink={cred.kaspiLink}
        />
        <AiMarkupCard percent={cred.aiMarkup} />
        <ErrorTrackingCard />
        <AlertsCard status={cred.alerts} />
        <ZernioWebhookCard />
        <TwoFactorCard status={cred.twoFactor} />
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

function RequisitesCard({
  requisites,
  recipient,
  kaspiLink,
}: {
  requisites: string;
  recipient: string;
  kaspiLink: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    await setPayoutRequisitesFn({
      data: {
        requisites: String(f.get("requisites") ?? ""),
        recipient: String(f.get("recipient") ?? ""),
        kaspiLink: String(f.get("kaspiLink") ?? ""),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <Card title="Реквизиты для выплат">
      <p className="mb-3 text-sm text-muted">
        Подставляются в счёт владельцу бота (карточка клиента → «Подписка и счета»). Снимок
        реквизитов хранится в каждом счёте — смена реквизитов не меняет уже выставленные. Владелец
        платит переводом на Kaspi и присылает чек своему боту: чек с точной суммой счёта продлевает
        подписку сам, остальные ждут вашей проверки.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <textarea
          className="input"
          name="requisites"
          rows={4}
          defaultValue={requisites}
          placeholder="Kaspi Gold 4400 …, получатель …"
        />
        <Field
          label="Получатель, как он написан в чеке Kaspi"
          hint="Пока поле пустое, каждый чек ждёт вашей проверки. Заполненное: чек с этим именем, точной суммой и номером операции продлевает подписку сам. Если принимаете и перевод, и оплату по ссылке Kaspi Pay, впишите оба имени через «;»: имя в чеке перевода и название магазина в чеке Kaspi Pay."
        >
          <input
            className="input"
            name="recipient"
            defaultValue={recipient}
            placeholder="Яков В.; FrogFlow"
          />
        </Field>
        <Field
          label="Ссылка Kaspi Pay для оплаты подписки"
          hint="Создаётся в вашем Kaspi Pay. Владелец по кнопке «Оплатить» получает её и QR с ней, вводит сумму счёта и платит. Пусто — только перевод по реквизитам."
        >
          <input
            className="input"
            name="kaspiLink"
            defaultValue={kaspiLink}
            placeholder="https://pay.kaspi.kz/pay/…"
          />
        </Field>
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

/**
 * Уведомления оператору о сбоях ботов клиентов и платформы (health-alerts): отдельный
 * бот от BotFather пишет в чат оператора. Токен в панель не возвращается.
 */
function AlertsCard({
  status,
}: {
  status: { configured: boolean; chatId: string | null; botUsername: string | null };
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useAction(async (f: FormData) => {
    await saveAlertChannelFn({
      data: { token: String(f.get("token") ?? ""), chatId: String(f.get("chatId") ?? "") },
    });
    setSaved(true);
    await router.invalidate();
  });
  const test = useAction(async () => setResult(await testAlertChannelFn()));
  const clear = useAction(async () => {
    await clearAlertChannelFn();
    setResult(null);
    await router.invalidate();
  });
  return (
    <Card title="Уведомления оператору">
      <p className="mb-3 text-sm text-muted">
        Когда бот клиента на v2 перестаёт отвечать (вебхук сломан, токен отозван, ошибки две
        проверки подряд), приходит одно сообщение о сбое и одно, когда бот снова ответит. Так же —
        про упавший или замолчавший крон, вебхук Zernio v2, который надо привязать заново, и
        отключившийся Instagram или WhatsApp клиента. Пишет отдельный бот: создайте его у
        @BotFather, откройте и нажмите «Старт». Chat id своего аккаунта можно узнать у @userinfobot.
      </p>
      <p className="mb-4 text-sm">
        Сейчас:{" "}
        {status.configured ? (
          <Badge tone="ok">
            настроены{status.botUsername ? `, бот @${status.botUsername}` : ""}
          </Badge>
        ) : (
          <Badge tone="warn">не настроены, сообщения не отправляются</Badge>
        )}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          setResult(null);
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field
          label="Токен бота от BotFather"
          hint={
            status.configured
              ? "Сохранён в зашифрованном виде. Оставьте пустым, чтобы не менять."
              : "Хранится в зашифрованном виде, как токены ботов клиентов."
          }
        >
          <input
            className="input font-mono"
            name="token"
            type="password"
            autoComplete="off"
            placeholder={status.configured ? "••••••••" : "123456789:AA…"}
          />
        </Field>
        <Field label="Chat id оператора">
          <input
            className="input font-mono"
            name="chatId"
            inputMode="numeric"
            defaultValue={status.chatId ?? ""}
            placeholder="123456789"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            Сохранить
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!status.configured || test.busy}
            onClick={() => void test.run().catch(() => {})}
          >
            Проверить
          </button>
          {status.configured && (
            <button
              type="button"
              className="btn-ghost"
              disabled={clear.busy}
              onClick={() => void clear.run().catch(() => {})}
            >
              Выключить
            </button>
          )}
          {saved && <span className="text-sm text-ok">Сохранено</span>}
        </div>
        {result && (
          <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>
        )}
        <ErrorBox error={save.error ?? test.error ?? clear.error} />
      </form>
    </Card>
  );
}

/** Учёт ошибок (src/lib/errors.ts): пробное событие в Sentry по кнопке. */
const WEBHOOK_ACTION: Record<string, string> = {
  unchanged: "привязан к профилям клиентов v2",
  none: "клиентов v2 с Instagram/WhatsApp нет — вебхук не нужен",
  create: "вебхука v2 нет — нажмите «Привязать»",
  update: "список профилей устарел — нажмите «Привязать»",
  disable: "клиентов v2 не осталось — «Привязать» выключит вебхук v2",
  skipped: "Zernio на платформе не подключён",
  error: "ошибка",
};

/**
 * Вебхук v2 в Zernio: своя запись с фильтром по профилям клиентов на v2.
 * Пишется только этой кнопкой (при переезде клиента); записи v1 с тем же
 * ключом v2 не меняет и не удаляет.
 */
function ZernioWebhookCard() {
  const [state, setState] = useState<Awaited<ReturnType<typeof v2WebhookStatusFn>> | null>(null);
  const check = useAction(async () => setState(await v2WebhookStatusFn()));
  const sync = useAction(async () => {
    const r = await syncV2WebhookFn();
    // Ошибку записи показываем как есть: повторная проверка её бы скрыла.
    setState(r.ok ? await v2WebhookStatusFn() : r);
  });
  return (
    <Card title="Вебхук Zernio (Instagram, WhatsApp)">
      <p className="mb-3 text-sm text-muted">
        У v2 свой вебхук: он получает события только профилей клиентов, переехавших на v2. Вебхуки
        прежней платформы остаются как есть. После переезда клиента нажмите «Привязать».
      </p>
      {state && (
        <div className="mb-3 space-y-1 text-sm">
          <p>
            <Badge tone={state.ok ? "ok" : "danger"}>
              {WEBHOOK_ACTION[state.action] ?? state.action}
            </Badge>{" "}
            {state.profiles !== undefined && <span>профилей v2: {state.profiles}</span>}
          </p>
          {state.error && <p className="text-danger">{state.error}</p>}
          {state.foreign?.length ? (
            <p className="text-muted">
              Другие вебхуки (не трогаем): {state.foreign.map((w) => w.name || w.url).join(", ")}
            </p>
          ) : null}
        </div>
      )}
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={check.busy || sync.busy}
          onClick={() => void check.run().catch(() => {})}
        >
          Проверить
        </button>
        <button
          className="btn-primary"
          disabled={check.busy || sync.busy}
          onClick={() => void sync.run().catch(() => {})}
        >
          Привязать
        </button>
      </div>
      <ErrorBox error={check.error ?? sync.error} />
    </Card>
  );
}

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

/**
 * Двухшаговый вход: код из приложения после пароля. Включается только
 * верным кодом из приложения; резервные коды показываются один раз.
 */
function TwoFactorCard({ status }: { status: { enabled: boolean; backupLeft: number } }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const start = useAction(async () => {
    setCodes(null);
    setSetup(await startTwoFactorFn());
  });
  const confirm = useAction(async (code: string) => {
    const r = await confirmTwoFactorFn({ data: { code } });
    setSetup(null);
    setCodes(r.backupCodes);
    await router.invalidate();
  });
  const disable = useAction(async (code: string) => {
    await disableTwoFactorFn({ data: { code } });
    setCodes(null);
    await router.invalidate();
  });
  const regen = useAction(async (code: string) => {
    setCodes((await regenerateBackupCodesFn({ data: { code } })).backupCodes);
    await router.invalidate();
  });
  const codeForm =
    (act: { run: (code: string) => Promise<unknown> }) => (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      void act
        .run(String(new FormData(form).get("code") ?? "").trim())
        .then(() => form.reset())
        .catch(() => {});
    };
  return (
    <Card title="Двухшаговый вход">
      <p className="mb-3 text-sm text-muted">
        После пароля панель спросит код из приложения-аутентификатора на телефоне (Google
        Authenticator, Microsoft Authenticator и подобные). Украденного пароля тогда мало.
      </p>
      <p className="mb-4 text-sm">
        Сейчас:{" "}
        {status.enabled ? (
          <>
            <Badge tone="ok">включён</Badge>{" "}
            <span className="text-muted">резервных кодов осталось: {status.backupLeft}</span>
          </>
        ) : (
          <Badge>выключен</Badge>
        )}
      </p>

      {codes && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          <p className="mb-2 font-medium">
            Резервные коды — сохраните их сейчас, больше они не покажутся.
          </p>
          <p className="mb-2 text-xs">
            Каждый код срабатывает один раз вместо кода из приложения, если телефон потерян.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {!status.enabled && !setup && (
        <>
          <button
            className="btn-primary"
            disabled={start.busy}
            onClick={() => void start.run().catch(() => {})}
          >
            Включить
          </button>
          <ErrorBox error={start.error} />
        </>
      )}

      {!status.enabled && setup && (
        <form className="space-y-3" onSubmit={codeForm(confirm)}>
          <p className="text-sm">
            1. Отсканируйте QR-код приложением-аутентификатором или введите ключ вручную.
          </p>
          <div
            className="w-44 rounded-md bg-white p-2"
            // SVG строим на сервере из ссылки otpauth (qrcode-generator), без внешних данных.
            dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          />
          <p className="break-all font-mono text-xs">
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </p>
          <Field label="2. Код из приложения" hint="Защита включится только после верного кода">
            <input
              className="input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </Field>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={confirm.busy}>
              Подтвердить и включить
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSetup(null)}>
              Отмена
            </button>
          </div>
          <ErrorBox error={confirm.error} />
        </form>
      )}

      {status.enabled && (
        <div className="space-y-4">
          <form className="space-y-2" onSubmit={codeForm(regen)}>
            <Field label="Новые резервные коды" hint="Старые перестанут работать">
              <input
                className="input"
                name="code"
                placeholder="Код из приложения"
                autoComplete="one-time-code"
                required
              />
            </Field>
            <button className="btn-secondary" disabled={regen.busy}>
              Выпустить новые коды
            </button>
            <ErrorBox error={regen.error} />
          </form>
          <form className="space-y-2" onSubmit={codeForm(disable)}>
            <Field label="Выключить двухшаговый вход" hint="Код из приложения или резервный код">
              <input
                className="input"
                name="code"
                placeholder="Код"
                autoComplete="one-time-code"
                required
              />
            </Field>
            <button className="btn-ghost" disabled={disable.busy}>
              Выключить
            </button>
            <ErrorBox error={disable.error} />
          </form>
        </div>
      )}
    </Card>
  );
}

/** Наценка на цену API в ИИ-балансе клиентов (core/ai/balance): одна на всех. */
function AiMarkupCard({ percent }: { percent: number }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    await setAiMarkupFn({
      data: { percent: Number(String(f.get("percent") ?? "0").replace(",", ".")) || 0 },
    });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <Card title="ИИ-баланс клиентов">
      <p className="mb-3 text-sm text-muted">
        Токены ИИ оплачивает клиент: при подключении у него $5, дальше он пополняет баланс. Каждый
        ответ консультанта, черновик помощника, умный поиск и распознавание чека списывают цену API
        плюс эта наценка.
      </p>
      <form
        className="flex items-end gap-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          setSaved(false);
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field label="Наценка, %">
          <input
            className="input w-28"
            name="percent"
            type="number"
            min={0}
            max={500}
            step="1"
            defaultValue={percent}
          />
        </Field>
        <button className="btn-primary" disabled={save.busy}>
          Сохранить
        </button>
        {saved && <span className="text-sm text-ok">Сохранено</span>}
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
