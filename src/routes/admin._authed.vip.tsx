import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveSettingsFn } from "@/app/admin/admin.functions";
import {
  addVipManualFn,
  connectVipBotFn,
  deleteVipTariffFn,
  runVipCronFn,
  saveVipTariffFn,
  vipProofUrlFn,
  vipStateFn,
  vipSubscriptionActionFn,
} from "@/app/admin/vip.functions";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/vip")({
  loader: () => vipStateFn(),
  component: VipPage,
});

type State = Awaited<ReturnType<typeof vipStateFn>>;
type Tariff = State["tariffs"][number];
type Sub = State["subscriptions"][number];

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" | "danger" }> = {
  active: { label: "активна", tone: "ok" },
  pending_payment: { label: "ждёт оплаты", tone: "warn" },
  expired: { label: "истекла", tone: "neutral" },
  cancelled: { label: "отклонена", tone: "danger" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru") : "—");

function VipPage() {
  const state = Route.useLoaderData();
  return (
    <>
      <PageTitle
        title="VIP-подписки"
        subtitle="Платный доступ в закрытую Telegram-группу: тарифы, чеки, автоматические напоминания и исключение по истечении. Работает отдельным VIP-ботом."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <BotCard state={state} />
        <SettingsCard state={state} />
        <TariffsCard state={state} />
        <SubscribersCard state={state} />
      </div>
    </>
  );
}

function BotCard({ state }: { state: State }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const connect = useAction(async (token: string) => {
    const r = await connectVipBotFn({ data: { token } });
    setNote(
      r.webhook.ok
        ? `VIP-бот @${r.username} подключён, вебхук установлен.`
        : `Токен принят, вебхук не установлен: ${r.webhook.error ?? "неизвестно"}`,
    );
    await router.invalidate();
  });
  const ok = state.bot.connected && state.bot.webhookOk;
  return (
    <Card
      title="VIP-бот"
      actions={
        state.bot.connected ? (
          <Badge tone={ok ? "ok" : "warn"}>
            {ok ? `@${state.bot.username} работает` : "проверьте вебхук"}
          </Badge>
        ) : (
          <Badge>не подключён</Badge>
        )
      }
    >
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Создайте отдельного бота в @BotFather и вставьте токен ниже.</li>
        <li>
          Добавьте бота администратором в закрытую группу с правом приглашать и исключать
          участников.
        </li>
        <li>
          Укажите ID группы в настройках справа (узнать: добавьте бота и напишите в группе /id
          основному боту).
        </li>
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void connect
            .run(String(new FormData(form).get("token")).trim())
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <input
          className="input"
          name="token"
          placeholder={state.bot.connected ? "Новый токен, если сменили бота" : "Токен VIP-бота"}
          autoComplete="off"
          required
        />
        <button className="btn-primary shrink-0" disabled={connect.busy}>
          {state.bot.connected ? "Заменить" : "Подключить"}
        </button>
      </form>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      <ErrorBox error={connect.error} />
    </Card>
  );
}

function SettingsCard({ state }: { state: State }) {
  const router = useRouter();
  const s = state.settings;
  const [test, setTest] = useState(s.testMode);
  const [saved, setSaved] = useState(false);
  const [cron, setCron] = useState<string | null>(null);
  const save = useAction(async (f: FormData) => {
    await saveSettingsFn({
      data: {
        vip_group_id: String(f.get("group_id") ?? "").trim(),
        vip_warn_days: String(f.get("warn_days") ?? "3"),
        vip_warn_days_2: String(f.get("warn_days_2") ?? "1"),
        vip_test_mode: test ? "true" : "false",
        vip_welcome_message: String(f.get("welcome") ?? ""),
        vip_payment_instructions: String(f.get("instructions") ?? ""),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const run = useAction(async () => {
    const r = await runVipCronFn();
    setCron(
      `Напоминаний: ${r.warned} + ${r.warned2}, истекло: ${r.expired}, не удалось исключить: ${r.kickFailed}.${r.errors.length ? `\n${r.errors.join("\n")}` : ""}`,
    );
  });
  const unit = test ? "мин." : "дн.";
  return (
    <Card title="Настройки VIP">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field label="ID VIP-группы" hint="Отрицательное число вида -1001234567890.">
          <input className="input" name="group_id" defaultValue={s.groupId} placeholder="-100…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Первое напоминание, ${unit} до конца`}>
            <input
              className="input"
              name="warn_days"
              type="number"
              min={1}
              defaultValue={s.warnDays}
            />
          </Field>
          <Field label={`Второе напоминание, ${unit} до конца`} hint="Строго меньше первого.">
            <input
              className="input"
              name="warn_days_2"
              type="number"
              min={1}
              defaultValue={s.warnDays2}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={test}
            onChange={setTest}
            label="Тест-режим: сроки в минутах вместо дней"
          />
          <span className="text-sm">{test ? "Включён" : "Выключен"}</span>
        </div>
        <Field label="Сообщение при активации">
          <input className="input" name="welcome" defaultValue={s.welcome} />
        </Field>
        <Field
          label="Реквизиты для оплаты"
          hint="Покупатель видит их после выбора тарифа и присылает чек в этот же чат."
        >
          <textarea className="input" name="instructions" rows={3} defaultValue={s.instructions} />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            Сохранить
          </button>
          {saved && <span className="text-sm text-ok">Сохранено</span>}
          <button
            type="button"
            className="btn-secondary"
            disabled={run.busy || !state.bot.connected}
            onClick={() => void run.run().catch(() => {})}
          >
            Проверить сроки сейчас
          </button>
        </div>
        {cron && <pre className="whitespace-pre-wrap text-xs text-muted">{cron}</pre>}
        <ErrorBox error={save.error ?? run.error} />
      </form>
    </Card>
  );
}

const EMPTY_TARIFF = {
  name: "",
  description: "",
  price: 0,
  currency: "KZT",
  duration_days: 30,
  duration_minutes: 5,
  is_active: true,
  is_public: true,
  is_entry: false,
  sort_order: 0,
};

function TariffsCard({ state }: { state: State }) {
  const router = useRouter();
  const [editing, setEditing] = useState<(typeof EMPTY_TARIFF & { id?: string }) | null>(null);
  const save = useAction(async (t: NonNullable<typeof editing>) => {
    await saveVipTariffFn({ data: t });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm("Удалить тариф?")) return;
    await deleteVipTariffFn({ data: { id } });
    await router.invalidate();
  });
  const edit = (t: Tariff) =>
    setEditing({
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      price: Number(t.price),
      currency: t.currency,
      duration_days: t.duration_days,
      duration_minutes: t.duration_minutes ?? 5,
      is_active: t.is_active,
      is_public: t.is_public,
      is_entry: t.is_entry,
      sort_order: t.sort_order,
    });
  const link = (t: Tariff) =>
    state.bot.username ? `https://t.me/${state.bot.username}?start=t_${t.id}` : null;
  return (
    <Card
      title="Тарифы"
      actions={
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setEditing({ ...EMPTY_TARIFF })}
        >
          + Тариф
        </button>
      }
      className="lg:col-span-2"
    >
      <p className="mb-3 text-sm text-muted">
        «Первый вход» показывается новым участникам один раз; продление — по публичным тарифам.
        Скрытый тариф (не публичный) доступен только по персональной ссылке и закрепляется за
        участником.
      </p>
      {state.tariffs.length === 0 ? (
        <Empty>Тарифов пока нет — добавьте первый.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Тариф</th>
                <th>Цена</th>
                <th>Срок</th>
                <th>Тип</th>
                <th>Ссылка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.tariffs.map((t) => (
                <tr key={t.id} className={t.is_active ? "" : "opacity-60"}>
                  <td>
                    <span className="font-medium">{t.name}</span>
                    {!t.is_active && <Badge>выключен</Badge>}
                  </td>
                  <td className="tabular-nums">
                    {Number(t.price)} {t.currency}
                  </td>
                  <td className="tabular-nums">
                    {t.duration_days} дн.
                    {t.duration_minutes ? ` (тест: ${t.duration_minutes} мин.)` : ""}
                  </td>
                  <td>
                    {t.is_entry ? (
                      <Badge tone="accent">первый вход</Badge>
                    ) : t.is_public ? (
                      "публичный"
                    ) : (
                      <Badge tone="warn">скрытый</Badge>
                    )}
                  </td>
                  <td className="max-w-[16rem] truncate text-xs text-muted">
                    {link(t) ?? "подключите бота"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button type="button" className="btn-ghost text-xs" onClick={() => edit(t)}>
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs text-danger"
                      disabled={del.busy}
                      onClick={() => void del.run(t.id).catch(() => {})}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorBox error={del.error} />
      {editing && (
        <form
          className="mt-4 grid gap-3 rounded-md border border-line p-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(editing).catch(() => {});
          }}
        >
          <Field label="Название">
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
            />
          </Field>
          <Field label="Описание">
            <input
              className="input"
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <Field label="Цена">
            <input
              className="input"
              type="number"
              min={0}
              value={editing.price}
              onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
            />
          </Field>
          <Field label="Валюта">
            <input
              className="input"
              value={editing.currency}
              maxLength={3}
              onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Срок, дней">
            <input
              className="input"
              type="number"
              min={1}
              value={editing.duration_days}
              onChange={(e) => setEditing({ ...editing, duration_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Срок в тест-режиме, минут">
            <input
              className="input"
              type="number"
              min={1}
              value={editing.duration_minutes ?? 5}
              onChange={(e) => setEditing({ ...editing, duration_minutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Порядок">
            <input
              className="input"
              type="number"
              value={editing.sort_order}
              onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-4 pt-5">
            <Switch
              checked={editing.is_active}
              onChange={(v) => setEditing({ ...editing, is_active: v })}
              label="Активен"
            />
            <Switch
              checked={editing.is_public}
              onChange={(v) => setEditing({ ...editing, is_public: v })}
              label="Публичный"
            />
            <Switch
              checked={editing.is_entry}
              onChange={(v) => setEditing({ ...editing, is_entry: v })}
              label="Первый вход"
            />
          </div>
          <div className="flex gap-2 md:col-span-2">
            <button className="btn-primary" disabled={save.busy}>
              Сохранить
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </div>
          <div className="md:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        </form>
      )}
    </Card>
  );
}

function who(s: Sub): string {
  const name = [s.first_name, s.last_name].filter(Boolean).join(" ");
  return name || (s.username ? `@${s.username}` : `id ${s.telegram_id}`);
}

function SubscribersCard({ state }: { state: State }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(
    async (p: {
      id: string;
      action: "confirm" | "reject" | "resend" | "exclude" | "delete" | "extend";
      days?: number;
      note?: string;
    }) => {
      const r = await vipSubscriptionActionFn({ data: p });
      setNote(r.message);
      await router.invalidate();
    },
  );
  const add = useAction(async (f: FormData) => {
    const r = await addVipManualFn({
      data: {
        telegramId: Number(f.get("telegram_id")),
        tariffId: String(f.get("tariff_id")),
        days: f.get("days") ? Number(f.get("days")) : undefined,
        status: String(f.get("status")) === "expired" ? "expired" : "active",
      },
    });
    setNote(r.warning ? `Добавлено. ${r.warning}` : "Подписка добавлена.");
    await router.invalidate();
  });
  const proof = useAction(async (id: string) => {
    const r = await vipProofUrlFn({ data: { id } });
    if (r.url) window.open(r.url, "_blank", "noopener");
    else setNote("Чек не сохранён.");
  });
  const rows = state.subscriptions.filter((s) => {
    if (status !== "all" && s.status !== status) return false;
    const t = q.trim().toLowerCase();
    return (
      !t ||
      who(s).toLowerCase().includes(t) ||
      String(s.telegram_id).includes(t) ||
      (s.tariff?.name ?? "").toLowerCase().includes(t)
    );
  });
  const extend = (s: Sub) => {
    const raw = prompt("На сколько дней изменить срок? Отрицательное число — сократить.", "30");
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days === 0) return;
    void act.run({ id: s.id, action: "extend", days }).catch(() => {});
  };
  const reject = (s: Sub) => {
    const n = prompt("Причина отказа (покупатель увидит её):", "") ?? undefined;
    void act.run({ id: s.id, action: "reject", note: n || undefined }).catch(() => {});
  };
  const pending = state.subscriptions.filter((s) => s.status === "pending_payment").length;
  return (
    <Card
      title="Подписчики"
      actions={pending > 0 ? <Badge tone="warn">{pending} ждут подтверждения</Badge> : undefined}
      className="lg:col-span-2"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Все статусы</option>
          <option value="pending_payment">Ждут оплаты</option>
          <option value="active">Активные</option>
          <option value="expired">Истекшие</option>
          <option value="cancelled">Отклонённые</option>
        </select>
        <input
          className="input w-64"
          placeholder="Имя, @username, ID или тариф"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <Empty>
          Подписчиков пока нет: покупатель появится здесь, как только выберет тариф в VIP-боте.
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Участник</th>
                <th>Тариф</th>
                <th>Статус</th>
                <th>До</th>
                <th>Чек</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = STATUS[s.status] ?? { label: s.status, tone: "neutral" as const };
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="font-medium">{who(s)}</span>
                      <span className="block text-xs text-muted">
                        id {s.telegram_id}
                        {s.imported ? " · вручную" : ""}
                      </span>
                    </td>
                    <td>
                      {s.tariff
                        ? `${s.tariff.name} · ${Number(s.tariff.price)} ${s.tariff.currency}`
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {s.admin_note?.startsWith("warned") && (
                        <span className="block text-xs text-muted">напоминание отправлено</span>
                      )}
                    </td>
                    <td className="tabular-nums text-xs">
                      {s.status === "pending_payment" ? fmt(s.created_at) : fmt(s.expires_at)}
                    </td>
                    <td>
                      {s.has_proof ? (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => void proof.run(s.id).catch(() => {})}
                        >
                          Открыть
                        </button>
                      ) : (
                        <span className="text-xs text-muted">нет</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {s.status === "pending_payment" && (
                        <>
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            disabled={act.busy}
                            onClick={() =>
                              void act.run({ id: s.id, action: "confirm" }).catch(() => {})
                            }
                          >
                            Подтвердить
                          </button>{" "}
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() => reject(s)}
                          >
                            Отклонить
                          </button>
                        </>
                      )}
                      {s.status === "active" && (
                        <>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() => extend(s)}
                          >
                            ± дни
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() =>
                              void act.run({ id: s.id, action: "resend" }).catch(() => {})
                            }
                          >
                            Переотправить ссылку
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs text-danger"
                            disabled={act.busy}
                            onClick={() =>
                              confirm("Исключить из группы и закрыть доступ?") &&
                              void act.run({ id: s.id, action: "exclude" }).catch(() => {})
                            }
                          >
                            Исключить
                          </button>
                        </>
                      )}
                      {s.status === "expired" && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={act.busy}
                          onClick={() => extend(s)}
                        >
                          Продлить
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost text-xs text-danger"
                        disabled={act.busy}
                        onClick={() =>
                          confirm("Удалить запись?") &&
                          void act.run({ id: s.id, action: "delete" }).catch(() => {})
                        }
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="mt-3 text-sm text-muted">{note}</p>}
      <ErrorBox error={act.error ?? add.error ?? proof.error} />
      <form
        className="mt-4 grid gap-3 rounded-md border border-line p-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void add
            .run(new FormData(form))
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <div className="md:col-span-4 text-sm font-medium">Добавить участника вручную</div>
        <Field label="Telegram ID">
          <input className="input" name="telegram_id" type="number" min={1} required />
        </Field>
        <Field label="Тариф">
          <select className="input" name="tariff_id" required>
            {state.tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дней (пусто — по тарифу)">
          <input className="input" name="days" type="number" min={1} />
        </Field>
        <Field label="Статус">
          <select className="input" name="status" defaultValue="active">
            <option value="active">Активна — отправить ссылку</option>
            <option value="expired">Истекла — только история</option>
          </select>
        </Field>
        <div className="md:col-span-4">
          <button className="btn-secondary" disabled={add.busy || state.tariffs.length === 0}>
            Добавить
          </button>
        </div>
      </form>
    </Card>
  );
}
