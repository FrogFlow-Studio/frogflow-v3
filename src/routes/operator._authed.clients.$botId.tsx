import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  archiveClientFn,
  connectTelegramFn,
  getClientFn,
  notifyOwnerFn,
  reinstallWebhookFn,
  setAddressingFn,
  setAdminCredentialsFn,
  setModuleFn,
  setServedByFn,
  setStatusFn,
  setZernioAccountsFn,
  updateClientMetaFn,
  addPaymentFn,
  billingFn,
  createInvoiceFn,
  invoiceActionFn,
  invoiceProofUrlFn,
} from "@/app/operator/operator.functions";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { Badge, Card, ErrorBox, Field, PageTitle, Stat, Switch, useAction } from "@/app/ui";
import { StatusBadge } from "./operator._authed.index";

export const Route = createFileRoute("/operator/_authed/clients/$botId")({
  loader: ({ params }) => getClientFn({ data: { botId: params.botId } }),
  component: ClientPage,
});

function ClientPage() {
  const { client: c, events, webhook } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const refresh = () => router.invalidate();

  const status = useAction(async (s: "active" | "paused" | "suspended") => {
    await setStatusFn({ data: { botId: c.id, status: s } });
    await refresh();
  });
  const archive = useAction(async () => {
    if (!confirm(`Архивировать «${c.name}»? Бот перестанет отвечать, данные останутся.`)) return;
    await archiveClientFn({ data: { botId: c.id } });
    await navigate({ to: "/operator" });
  });

  return (
    <>
      <PageTitle
        title={
          <span className="flex items-center gap-2">
            {c.name} <StatusBadge status={c.status} />
          </span>
        }
        subtitle={`${c.verticalTitle} · создан ${c.createdAt ? new Date(c.createdAt).toLocaleDateString("ru") : "—"}`}
        actions={
          <>
            {c.status === "active" ? (
              <button
                className="btn-secondary"
                disabled={status.busy}
                onClick={() => void status.run("paused").catch(() => {})}
              >
                ⏸ Поставить на паузу
              </button>
            ) : (
              <button
                className="btn-primary"
                disabled={status.busy}
                onClick={() => void status.run("active").catch(() => {})}
              >
                ▶ Возобновить
              </button>
            )}
            <button
              className="btn-ghost text-danger"
              disabled={archive.busy}
              onClick={() => void archive.run().catch(() => {})}
            >
              Архивировать
            </button>
          </>
        }
      />
      <ErrorBox error={status.error ?? archive.error} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Заказов за 30 дней"
          value={c.stats?.orders_30d ?? "—"}
          hint={
            c.stats?.last_order_at
              ? `последний ${new Date(c.stats.last_order_at).toLocaleDateString("ru")}`
              : undefined
          }
        />
        <Stat label="Заказов всего" value={c.stats?.orders_total ?? "—"} />
        <Stat label="Товаров" value={c.stats?.products_total ?? "—"} />
        <Stat
          label="Покупателей"
          value={c.stats?.customers_total?.toLocaleString("ru") ?? "—"}
          hint={
            c.stats ? `${(c.stats.storage_bytes / 1024 / 1024).toFixed(0)} МБ файлов` : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TelegramCard c={c} webhook={webhook} onDone={refresh} />
        <AdminAccessCard c={c} onDone={refresh} />
        <ModulesCard c={c} onDone={refresh} />
        <div className="space-y-4">
          <AddressingCard c={c} onDone={refresh} />
          <MetaCard c={c} onDone={refresh} />
          <MessageCard c={c} />
          <BillingCard c={c} />
        </div>
      </div>

      <Card title="Журнал" className="mt-4">
        {events.length === 0 ? (
          <p className="text-sm text-muted">Событий пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Кто</th>
                <th>Что</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(e.at).toLocaleString("ru")}
                  </td>
                  <td>{e.actor}</td>
                  <td>{e.kind}</td>
                  <td className="max-w-md truncate font-mono text-xs text-muted">
                    {JSON.stringify(e.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

type C = Awaited<ReturnType<typeof getClientFn>>["client"];
type W = Awaited<ReturnType<typeof getClientFn>>["webhook"];

function TelegramCard({ c, webhook, onDone }: { c: C; webhook: W; onDone: () => Promise<void> }) {
  const connect = useAction(async (token: string) => {
    await connectTelegramFn({ data: { botId: c.id, token } });
    await onDone();
  });
  const serve = useAction(async (v: "v1" | "v2") => {
    await setServedByFn({ data: { botId: c.id, servedBy: v } });
    await onDone();
  });
  const reinstall = useAction(async () => {
    await reinstallWebhookFn({ data: { botId: c.id } });
    await onDone();
  });
  return (
    <Card
      title="Telegram"
      actions={
        c.telegram.connected ? (
          <Badge tone="ok">@{c.telegram.username ?? "бот"}</Badge>
        ) : (
          <Badge>не подключён</Badge>
        )
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void connect
            .run(String(f.get("token")).trim())
            .then(() => (e.target as HTMLFormElement).reset?.())
            .catch(() => {});
        }}
      >
        <input
          className="input"
          name="token"
          placeholder={
            c.telegram.connected ? "Новый токен, если бот сменился" : "Токен из BotFather"
          }
          autoComplete="off"
          required
        />
        <button className="btn-secondary shrink-0" disabled={connect.busy}>
          {c.telegram.connected ? "Заменить" : "Подключить"}
        </button>
      </form>
      <ErrorBox error={connect.error ?? serve.error ?? reinstall.error} />
      {c.telegram.connected && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Обслуживает эта платформа</div>
              <div className="text-xs text-muted">
                Выключено — бот остаётся на старом деплое v1.
              </div>
            </div>
            <Switch
              checked={c.servedBy === "v2"}
              disabled={serve.busy}
              onChange={(on) => void serve.run(on ? "v2" : "v1").catch(() => {})}
              label="served by v2"
            />
          </div>
          {webhook && (
            <div className="rounded-md bg-surface-2 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span>
                  Вебхук{" "}
                  {webhook.ok ? (
                    <Badge tone="ok">на этом деплое</Badge>
                  ) : (
                    <Badge tone="warn">{webhook.url ? "на другом адресе" : "не установлен"}</Badge>
                  )}
                </span>
                <button
                  className="btn-ghost text-xs"
                  disabled={reinstall.busy || c.servedBy !== "v2"}
                  onClick={() => void reinstall.run().catch(() => {})}
                >
                  Переустановить
                </button>
              </div>
              <div className="mt-1 truncate font-mono text-muted">{webhook.url ?? "—"}</div>
              {webhook.pending > 0 && (
                <div className="mt-1 text-warn">В очереди Telegram: {webhook.pending}</div>
              )}
              {webhook.error && <div className="mt-1 text-danger">{webhook.error}</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ModulesCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const toggle = useAction(async (key: ModuleKey, on: boolean) => {
    await setModuleFn({ data: { botId: c.id, key, on } });
    await onDone();
  });
  const groups = new Map<string, ModuleKey[]>();
  for (const k of MODULE_KEYS) {
    const g = moduleDef(k).group;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  return (
    <Card
      title="Модули"
      actions={<span className="text-xs text-muted">{c.modulesOn} включено</span>}
    >
      <ErrorBox error={toggle.error} />
      <div className="space-y-4">
        {[...groups.entries()].map(([group, keys]) => (
          <div key={group}>
            <div className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
              {group}
            </div>
            <div className="divide-y divide-line">
              {keys.map((k) => {
                const d = moduleDef(k);
                const planned = d.status !== "available";
                return (
                  <div key={k} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={planned ? "text-muted" : ""}>{d.title}</span>
                        {planned && <Badge>в разработке</Badge>}
                        {d.price === null && !planned && <Badge tone="accent">в пакете</Badge>}
                      </div>
                      <div className="text-xs text-muted">
                        {d.price ? `${d.price.toLocaleString("ru")} ₸` : ""}
                        {d.requires?.length
                          ? ` · требует: ${d.requires.map((r) => moduleDef(r as ModuleKey).title).join(", ")}`
                          : ""}
                      </div>
                    </div>
                    <Switch
                      checked={c.modules[k]}
                      disabled={planned || toggle.busy}
                      onChange={(on) => void toggle.run(k, on).catch(() => {})}
                      label={d.title}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AdminAccessCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const set = useAction(async (username: string, password: string) => {
    await setAdminCredentialsFn({ data: { botId: c.id, username, password } });
    await onDone();
  });
  const [done, setDone] = useState(false);
  return (
    <Card
      title="Вход продавца в админку"
      actions={
        c.adminUsername ? <Badge tone="ok">{c.adminUsername}</Badge> : <Badge>не настроен</Badge>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void set
            .run(String(f.get("username")).trim().toLowerCase(), String(f.get("password")))
            .then(() => setDone(true))
            .catch(() => {});
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Логин">
            <input
              className="input"
              name="username"
              defaultValue={c.adminUsername ?? c.slug ?? ""}
              pattern="[a-z0-9_.\-]{3,40}"
              required
            />
          </Field>
          <Field label="Новый пароль">
            <input
              className="input"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" disabled={set.busy}>
            Сохранить
          </button>
          {done && <span className="text-xs text-ok">Сохранено. Вход: </span>}
          <Link to="/admin/login" className="text-xs text-accent hover:underline">
            /admin/login
          </Link>
        </div>
        <ErrorBox error={set.error} />
      </form>
    </Card>
  );
}

function AddressingCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const addr = useAction(async (slug: string, hosts: string[]) => {
    await setAddressingFn({ data: { botId: c.id, slug: slug || null, hosts } });
    await onDone();
  });
  const zr = useAction(async (ids: string[]) => {
    await setZernioAccountsFn({ data: { botId: c.id, accountIds: ids } });
    await onDone();
  });
  return (
    <Card title="Адреса и каналы">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const hosts = String(f.get("hosts"))
            .split(/[\s,]+/)
            .map((h) => h.trim())
            .filter(Boolean);
          void addr.run(String(f.get("slug")).trim().toLowerCase(), hosts).catch(() => {});
        }}
      >
        <Field label="Короткий адрес" hint="Витрина и Mini App: /s/<адрес>">
          <input
            className="input"
            name="slug"
            defaultValue={c.slug ?? ""}
            pattern="[a-z0-9\-]{2,40}"
          />
        </Field>
        <Field label="Свои домены" hint="Через запятую. DNS домена должен смотреть на платформу.">
          <input
            className="input"
            name="hosts"
            defaultValue={c.hosts.join(", ")}
            placeholder="shop.example.kz"
          />
        </Field>
        <button className="btn-secondary" disabled={addr.busy}>
          Сохранить адреса
        </button>
        <ErrorBox error={addr.error} />
      </form>
      <form
        className="mt-5 space-y-3 border-t border-line pt-4"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const ids = String(new FormData(e.currentTarget).get("zernio"))
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          void zr.run(ids).catch(() => {});
        }}
      >
        <Field
          label="Аккаунты Zernio (Instagram, WhatsApp)"
          hint="Идентификаторы аккаунтов через запятую. События этих аккаунтов попадут этому клиенту."
        >
          <input className="input" name="zernio" defaultValue={c.zernioAccounts.join(", ")} />
        </Field>
        <button className="btn-secondary" disabled={zr.busy}>
          Сохранить аккаунты
        </button>
        <ErrorBox error={zr.error} />
      </form>
    </Card>
  );
}

function MetaCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const save = useAction(async (f: FormData) => {
    const tg = String(f.get("ownerTelegramId")).trim();
    await updateClientMetaFn({
      data: {
        botId: c.id,
        name: String(f.get("name")),
        vertical: String(f.get("vertical")),
        ownerName: String(f.get("ownerName")) || null,
        ownerContact: String(f.get("ownerContact")) || null,
        ownerTelegramId: tg ? Number(tg) : null,
        notes: String(f.get("notes")) || null,
        pausedMessage: String(f.get("pausedMessage")) || null,
      },
    });
    await onDone();
  });
  return (
    <Card title="Карточка">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field label="Название">
          <input className="input" name="name" defaultValue={c.name} required />
        </Field>
        <Field label="Ниша">
          <select className="input" name="vertical" defaultValue={c.vertical}>
            {VERTICAL_KEYS.map((k) => (
              <option key={k} value={k}>
                {VERTICALS[k].title}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Владелец">
            <input className="input" name="ownerName" defaultValue={c.ownerName ?? ""} />
          </Field>
          <Field label="Контакт">
            <input className="input" name="ownerContact" defaultValue={c.ownerContact ?? ""} />
          </Field>
        </div>
        <Field
          label="Telegram ID владельца"
          hint="Получает уведомления о заказах вместе со списком admin_chat_id."
        >
          <input
            className="input"
            name="ownerTelegramId"
            defaultValue={c.ownerTelegramId ?? ""}
            inputMode="numeric"
          />
        </Field>
        <Field label="Текст бота на паузе">
          <input
            className="input"
            name="pausedMessage"
            defaultValue={c.pausedMessage ?? ""}
            placeholder="Бот временно недоступен…"
          />
        </Field>
        <Field label="Заметки">
          <textarea className="input" name="notes" rows={3} defaultValue={c.notes ?? ""} />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          Сохранить
        </button>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

type Billing = Awaited<ReturnType<typeof billingFn>>;

const INVOICE_STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "neutral" | "danger" }
> = {
  sent: { label: "выставлен", tone: "neutral" },
  proof_uploaded: { label: "чек прислан", tone: "warn" },
  paid: { label: "оплачен", tone: "ok" },
  rejected: { label: "отклонён", tone: "danger" },
  cancelled: { label: "отменён", tone: "neutral" },
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, d: number) => {
  const x = new Date(iso);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

function BillingCard({ c }: { c: C }) {
  const [data, setData] = useState<Billing | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useAction(async () => setData(await billingFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const invoice = useAction(async (f: FormData) => {
    const r = await createInvoiceFn({
      data: {
        botId: c.id,
        amount: Number(f.get("amount")),
        currency: String(f.get("currency") || "KZT"),
        note: String(f.get("note") || "") || null,
      },
    });
    setNote(
      r.delivered
        ? "Счёт выставлен и отправлен владельцу в его боте."
        : `Счёт выставлен, но не доставлен: ${r.deliveryError ?? "владелец не получил сообщение"}.`,
    );
    await load.run();
  });
  const payment = useAction(async (f: FormData) => {
    const r = await addPaymentFn({
      data: {
        botId: c.id,
        period_start: String(f.get("period_start")),
        period_end: String(f.get("period_end")),
        amount: Number(f.get("amount")),
        currency: String(f.get("currency") || "KZT"),
        note: String(f.get("note") || "") || null,
      },
    });
    setNote(
      `Платёж записан, подписка до ${r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("ru") : "—"}.`,
    );
    await load.run();
  });
  const act = useAction(
    async (p: {
      id: string;
      action: "confirm" | "reject" | "cancel";
      periodStart?: string;
      periodEnd?: string;
      reason?: string;
    }) => {
      const r = await invoiceActionFn({ data: p });
      setNote(r.message);
      await load.run();
    },
  );
  const proof = useAction(async (id: string) => {
    const r = await invoiceProofUrlFn({ data: { id } });
    if (r.url) window.open(r.url, "_blank", "noopener");
  });
  const confirm = (id: string) => {
    const start = prompt("Начало оплаченного периода (ГГГГ-ММ-ДД):", today());
    if (!start) return;
    const end = prompt("Конец периода (ГГГГ-ММ-ДД):", plusDays(start, 30));
    if (!end) return;
    void act.run({ id, action: "confirm", periodStart: start, periodEnd: end }).catch(() => {});
  };
  const reject = (id: string) => {
    const reason = prompt("Причина отказа:", "") ?? "";
    void act.run({ id, action: "reject", reason }).catch(() => {});
  };
  const expires = data?.expiresAt ?? c.subscriptionExpiresAt;
  const overdue = expires ? new Date(expires).getTime() < Date.now() : false;
  return (
    <Card
      title="Подписка и счета"
      actions={
        expires ? (
          <Badge tone={overdue ? "danger" : "ok"}>
            {overdue ? "просрочена с" : "оплачена до"} {new Date(expires).toLocaleDateString("ru")}
          </Badge>
        ) : (
          <Badge>платежей нет</Badge>
        )
      }
    >
      {!data ? (
        <p className="text-sm text-muted">Загрузка…</p>
      ) : (
        <div className="space-y-4">
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              void invoice
                .run(new FormData(form))
                .then(() => form.reset())
                .catch(() => {});
            }}
          >
            <div className="text-sm font-medium sm:col-span-3">Выставить счёт владельцу</div>
            <input
              className="input"
              name="amount"
              type="number"
              min={1}
              step="0.01"
              placeholder="Сумма"
              required
            />
            <input className="input" name="currency" defaultValue="KZT" maxLength={8} />
            <input className="input" name="note" placeholder="За что (необязательно)" />
            <div className="sm:col-span-3">
              <button className="btn-primary" disabled={invoice.busy || !data.requisites}>
                Выставить
              </button>
              {!data.requisites && (
                <span className="ml-2 text-xs text-warn">
                  Сначала заполните реквизиты в настройках платформы.
                </span>
              )}
            </div>
          </form>
          {data.invoices.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => {
                  const st = INVOICE_STATUS[i.status] ?? {
                    label: i.status,
                    tone: "neutral" as const,
                  };
                  return (
                    <tr key={i.id}>
                      <td>
                        <span className="font-medium">
                          {i.amount} {i.currency}
                        </span>
                        {i.note && <span className="block text-xs text-muted">{i.note}</span>}
                        <span className="block text-xs text-muted">
                          {new Date(i.created_at).toLocaleDateString("ru")}
                        </span>
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {i.reject_reason && (
                          <span className="block text-xs text-muted">{i.reject_reason}</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {i.has_proof && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => void proof.run(i.id).catch(() => {})}
                          >
                            Чек
                          </button>
                        )}
                        {(i.status === "sent" || i.status === "proof_uploaded") && (
                          <>
                            <button
                              type="button"
                              className="btn-primary text-xs"
                              disabled={act.busy}
                              onClick={() => confirm(i.id)}
                            >
                              Оплачен
                            </button>{" "}
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              disabled={act.busy}
                              onClick={() => reject(i.id)}
                            >
                              Отклонить
                            </button>
                          </>
                        )}
                        {i.status === "sent" && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() =>
                              void act.run({ id: i.id, action: "cancel" }).catch(() => {})
                            }
                          >
                            Отменить
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              void payment
                .run(new FormData(form))
                .then(() => form.reset())
                .catch(() => {});
            }}
          >
            <div className="text-sm font-medium sm:col-span-3">Записать платёж без счёта</div>
            <input
              className="input"
              name="period_start"
              type="date"
              defaultValue={today()}
              required
            />
            <input
              className="input"
              name="period_end"
              type="date"
              defaultValue={plusDays(today(), 30)}
              required
            />
            <input
              className="input"
              name="amount"
              type="number"
              min={0}
              step="0.01"
              placeholder="Сумма"
              required
            />
            <input className="input" name="currency" defaultValue="KZT" maxLength={8} />
            <input className="input sm:col-span-2" name="note" placeholder="Примечание" />
            <div className="sm:col-span-3">
              <button className="btn-secondary" disabled={payment.busy}>
                Записать
              </button>
            </div>
          </form>
          {data.payments.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {data.payments.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-1.5">
                  <span>
                    {new Date(p.period_start).toLocaleDateString("ru")} –{" "}
                    {new Date(p.period_end).toLocaleDateString("ru")}
                    {p.note && <span className="text-muted"> · {p.note}</span>}
                  </span>
                  <span className="tabular-nums">
                    {p.amount} {p.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="text-sm text-muted">{note}</p>}
          <ErrorBox
            error={load.error ?? invoice.error ?? payment.error ?? act.error ?? proof.error}
          />
        </div>
      )}
    </Card>
  );
}

function MessageCard({ c }: { c: C }) {
  const [result, setResult] = useState<string | null>(null);
  const send = useAction(async (text: string) => {
    const r = await notifyOwnerFn({ data: { botId: c.id, text } });
    setResult(
      `Доставлено: ${r.delivered.length}${r.failed.length ? `, не доставлено: ${r.failed.map((f) => `${f.id} (${f.reason})`).join("; ")}` : ""}`,
    );
  });
  return (
    <Card
      title="Написать владельцу"
      actions={<span className="text-xs text-muted">от имени его бота</span>}
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void send.run(String(new FormData(e.currentTarget).get("text"))).catch(() => {});
        }}
      >
        <textarea className="input" name="text" rows={3} required placeholder="Текст сообщения" />
        <button className="btn-secondary" disabled={send.busy || !c.telegram.connected}>
          Отправить
        </button>
        {result && <p className="text-xs text-muted">{result}</p>}
        <ErrorBox error={send.error} />
      </form>
    </Card>
  );
}
