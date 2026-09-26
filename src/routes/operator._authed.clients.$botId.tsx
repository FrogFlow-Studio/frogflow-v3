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
  setConsultantLimitsFn,
  setModuleFn,
  setServedByFn,
  setStatusFn,
  setZernioAccountsFn,
  syncZernioFn,
  updateClientMetaFn,
  addPaymentFn,
  billingFn,
  createInvoiceFn,
  invoiceActionFn,
  invoiceProofUrlFn,
  setOverduePolicyFn,
  healthHistoryFn,
  recordHealthNowFn,
  planFn,
  setPlanFn,
  planActionFn,
  setAiQuotaFn,
  planInvoicePreviewFn,
  createPlanInvoiceFn,
} from "@/app/operator/operator.functions";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  ADDON_KEYS,
  CONNECTION_PRICE,
  MONTHLY_PRICE,
  PLAN_TIERS,
  TIER_TITLES,
  parsePlan,
  type AddonKey,
  type PlanTier,
} from "@/core/plans/registry";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { Badge, Card, ErrorBox, Field, PageTitle, Stat, Switch, useAction } from "@/app/ui";
import { StatusBadge } from "./operator._authed.index";

export const Route = createFileRoute("/operator/_authed/clients/$botId")({
  loader: ({ params }) => getClientFn({ data: { botId: params.botId } }),
  component: ClientPage,
});

function ClientPage() {
  const { client: c, events, webhook, migration, consultant } = Route.useLoaderData();
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
        <TelegramCard c={c} webhook={webhook} migration={migration} onDone={refresh} />
        <AdminAccessCard c={c} onDone={refresh} />
        <div className="space-y-4">
          <PlanCard c={c} onDone={refresh} />
          <ModulesCard c={c} onDone={refresh} />
        </div>
        <div className="space-y-4">
          <AddressingCard c={c} onDone={refresh} />
          <ZernioCard c={c} onDone={refresh} />
          <MetaCard c={c} onDone={refresh} />
          <ConsultantLimitsCard c={c} budget={consultant} onDone={refresh} />
          <MessageCard c={c} />
          <BillingCard c={c} />
          <HealthCard c={c} />
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
type M = Awaited<ReturnType<typeof getClientFn>>["migration"];

const LEVEL_TONE = { ok: "ok", info: "neutral", warn: "warn", block: "danger" } as const;
const LEVEL_MARK = { ok: "✓", info: "i", warn: "!", block: "✕" } as const;

/** Предполётная проверка переезда: что блокирует, что стоит поправить, что напомнить. */
function MigrationChecks({ m }: { m: M }) {
  return (
    <div className="rounded-md border border-line p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Готовность к переезду</span>
        <Badge tone={m.ready ? "ok" : "danger"}>{m.ready ? "можно переводить" : "не готов"}</Badge>
      </div>
      <ul className="space-y-1.5">
        {m.checks.map((ch) => (
          <li key={ch.key} className="flex items-start gap-2">
            <Badge tone={LEVEL_TONE[ch.level]}>{LEVEL_MARK[ch.level]}</Badge>
            <span>
              <span className="font-medium">{ch.title}</span>
              <span className="block text-muted">{ch.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TelegramCard({
  c,
  webhook,
  migration,
  onDone,
}: {
  c: C;
  webhook: W;
  migration: M;
  onDone: () => Promise<void>;
}) {
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
      {c.servedBy !== "v2" && (
        <div className="mt-4">
          <MigrationChecks m={migration} />
        </div>
      )}
      {(c.telegram.connected || c.servedBy === "v2") && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Обслуживает эта платформа</div>
              <div className="text-xs text-muted">
                {c.servedBy === "v2"
                  ? "Выключите — бот вернётся на деплой v1 (там переустановите вебхук)."
                  : migration.ready
                    ? "Включите — вебхук переставится сюда, заказы и выдача пойдут через v2."
                    : "Пока не готов: сначала уберите блокирующие пункты выше."}
              </div>
            </div>
            <Switch
              checked={c.servedBy === "v2"}
              disabled={serve.busy || (c.servedBy !== "v2" && !migration.ready)}
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

type PlanView = Awaited<ReturnType<typeof planFn>>;

const fmt = (n: number) => `${n.toLocaleString("ru")} ₸`;

/**
 * Тариф клиента: план ниши (Basic/Pro/Business) или индивидуальные условия,
 * надбавки каналов, пробный период, подбор плана действующему клиенту,
 * лимиты ИИ и счёт по плану. Модули ниже пересчитываются по плану сами.
 */
function PlanCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const [v, setV] = useState<PlanView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useAction(async () => setV(await planFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.plan]);
  const parsed = parsePlan(c.plan);
  const [tier, setTier] = useState<PlanTier | "custom">(
    parsed?.kind === "tier" ? parsed.tier : parsed?.kind === "custom" ? "custom" : "basic",
  );
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [addons, setAddons] = useState<AddonKey[]>([]);
  const [prices, setPrices] = useState<Partial<Record<AddonKey, number>>>({});
  useEffect(() => {
    if (!v) return;
    setPeriod(v.billing.period ?? "month");
    setAddons(v.billing.addons ?? []);
  }, [v]);
  const save = useAction(async () => {
    if (
      !confirm(
        tier === "custom"
          ? "Перевести на индивидуальные условия? Модули останутся как есть."
          : "Сменить план? Модули клиента пересчитаются: всё, что не входит в план, надбавки и сохранённое, выключится.",
      )
    )
      return;
    await setPlanFn({ data: { botId: c.id, tier, period, addons } });
    setNote("План сохранён, модули пересчитаны.");
    await onDone();
    await load.run();
  });
  const action = useAction(async (a: "adopt" | "trial") => {
    const r = await planActionFn({ data: { botId: c.id, action: a } });
    setNote(r.message);
    await onDone();
    await load.run();
  });
  const quota = useAction(async (f: FormData) => {
    const val = (k: string) => {
      const x = String(f.get(k) ?? "").trim();
      return x === "" ? undefined : x === "-" ? null : Number(x);
    };
    await setAiQuotaFn({
      data: { botId: c.id, ai_dialogs: val("ai_dialogs"), receipt_checks: val("receipt_checks") },
    });
    setNote("Лимиты сохранены.");
    await load.run();
  });
  const [shown, setShown] = useState<Awaited<ReturnType<typeof planInvoicePreviewFn>> | null>(null);
  const preview = useAction(async () =>
    setShown(await planInvoicePreviewFn({ data: { botId: c.id, period, addonPrices: prices } })),
  );
  const invoice = useAction(async () => {
    const r = await createPlanInvoiceFn({ data: { botId: c.id, period, addonPrices: prices } });
    setNote(
      r.delivered
        ? `Счёт на ${fmt(r.invoice.amount)} выставлен и отправлен владельцу.`
        : `Счёт на ${fmt(r.invoice.amount)} выставлен, но не доставлен: ${r.deliveryError ?? "владелец не получил сообщение"}.`,
    );
    setShown(null);
    await load.run();
  });
  const onTier = parsed?.kind === "tier";
  const limitText = (used: number, limit: number | null | undefined) =>
    limit === undefined
      ? `${used}`
      : limit === null
        ? `${used} · без лимита`
        : `${used} из ${limit}`;
  return (
    <Card
      title="Тариф"
      actions={
        <Badge tone={parsed ? "accent" : "neutral"}>
          {parsed?.kind === "tier"
            ? TIER_TITLES[parsed.tier]
            : parsed?.kind === "custom"
              ? "по договору"
              : "без плана"}
        </Badge>
      }
    >
      {!v ? (
        <p className="text-sm text-muted">Загрузка…</p>
      ) : (
        <div className="space-y-4 text-sm">
          {v.writeBlock && <p className="text-warn">{v.writeBlock}</p>}
          {!v.niche && (
            <p className="text-muted">
              У этой ниши нет тарифов (консультант BOVI — по договору). Выберите «Индивидуальный»,
              модули включаются вручную.
            </p>
          )}
          {v.suggestion && (
            <div className="rounded-md border border-line p-3">
              <div className="font-medium">
                Подходит план {TIER_TITLES[v.suggestion.tier]}
                {v.suggestion.grandfathered.length > 0 &&
                  ` + бесплатно сохранить: ${v.suggestion.grandfathered.map((k) => moduleDef(k).title).join(", ")}`}
              </div>
              <p className="mt-1 text-xs text-muted">
                Для действующего клиента: купленное остаётся бесплатно, подключение не берётся, срок
                подписки не меняется.
              </p>
              <button
                className="btn-secondary mt-2 text-xs"
                disabled={action.busy}
                onClick={() => void action.run("adopt").catch(() => {})}
              >
                Перевести на подобранный план
              </button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="План">
              <select
                className="input"
                value={tier}
                onChange={(e) => setTier(e.target.value as PlanTier | "custom")}
              >
                {v.niche &&
                  PLAN_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {TIER_TITLES[t]} · {fmt(MONTHLY_PRICE[t])}/мес, подключение{" "}
                      {fmt(CONNECTION_PRICE[t])}
                    </option>
                  ))}
                <option value="custom">Индивидуальный (по договору)</option>
              </select>
            </Field>
            <Field label="Оплата">
              <select
                className="input"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as "month" | "year");
                  setShown(null);
                }}
              >
                <option value="month">помесячно</option>
                <option value="year">за год (12 мес. по цене 10)</option>
              </select>
            </Field>
          </div>
          {tier !== "custom" && (
            <div className="flex flex-wrap gap-4">
              {ADDON_KEYS.map((a) => (
                <label key={a} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={addons.includes(a)}
                    onChange={(e) =>
                      setAddons((xs) => (e.target.checked ? [...xs, a] : xs.filter((x) => x !== a)))
                    }
                  />
                  {ADDONS[a].title} сверх плана
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              Сохранить план
            </button>
            {v.niche && !v.billing.trial_until && (
              <button
                className="btn-secondary"
                disabled={action.busy}
                onClick={() => void action.run("trial").catch(() => {})}
              >
                Пробный период 14 дней
              </button>
            )}
          </div>
          {v.billing.trial_until && (
            <p className="text-xs text-muted">
              Пробный период до {new Date(v.billing.trial_until).toLocaleDateString("ru")}
            </p>
          )}
          {v.outsidePlan.length > 0 && (
            <p className="text-xs text-warn">
              Включены вне плана: {v.outsidePlan.map((k) => moduleDef(k).title).join(", ")}.
              Сохраните план, чтобы пересчитать модули.
            </p>
          )}
          {onTier && (
            <>
              <div className="border-t border-line pt-3">
                <div className="font-medium">ИИ за {v.usage.month}</div>
                <div className="text-muted">
                  Диалоги консультанта: {limitText(v.usage.aiDialogs, v.usage.limits?.aiDialogs)}
                  <br />
                  Проверки чеков: {limitText(v.usage.receiptChecks, v.usage.limits?.receiptChecks)}
                </div>
                {v.upgrade && (
                  <p className="mt-1 text-warn">
                    {v.upgrade.level === "over" ? "Лимит исчерпан" : "Лимит почти израсходован"} (
                    {v.upgrade.what
                      .map((w) => (w === "aiDialogs" ? "диалоги" : "проверки чеков"))
                      .join(", ")}
                    ).{" "}
                    {v.upgrade.next
                      ? `Предложите клиенту план ${TIER_TITLES[v.upgrade.next]}.`
                      : "Это старший план: договоритесь о своём лимите."}
                  </p>
                )}
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-3"
                  onSubmit={(e: FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    void quota.run(new FormData(e.currentTarget)).catch(() => {});
                  }}
                >
                  <input
                    className="input"
                    name="ai_dialogs"
                    placeholder="диалогов: как в плане"
                    defaultValue={v.billing.ai_quota?.ai_dialogs ?? ""}
                  />
                  <input
                    className="input"
                    name="receipt_checks"
                    placeholder="чеков: как в плане"
                    defaultValue={
                      v.billing.ai_quota?.receipt_checks === null
                        ? "-"
                        : (v.billing.ai_quota?.receipt_checks ?? "")
                    }
                  />
                  <button className="btn-secondary" disabled={quota.busy}>
                    Свой лимит
                  </button>
                  <p className="text-xs text-muted sm:col-span-3">
                    Пусто — как в плане, «-» — без лимита. Сверх лимита новые диалоги уходят
                    менеджеру, чеки — на ручную проверку.
                  </p>
                </form>
              </div>
              <div className="border-t border-line pt-3">
                <div className="font-medium">Счёт по плану</div>
                {(v.billing.addons ?? []).map((a) => (
                  <label key={a} className="mt-1 flex items-center gap-2">
                    <span className="w-40 text-muted">{ADDONS[a].title}, ₸ в месяц</span>
                    <input
                      className="input w-32"
                      type="number"
                      min={0}
                      value={prices[a] ?? ADDON_MONTHLY_PRICE[a]}
                      onChange={(e) => setPrices((p) => ({ ...p, [a]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
                {shown && (
                  <ul className="mt-2 text-muted">
                    {shown.lines.map((l) => (
                      <li key={l.title} className="flex justify-between">
                        <span>{l.title}</span>
                        <span className="tabular-nums">{fmt(l.amount)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between font-medium text-fg">
                      <span>Итого</span>
                      <span className="tabular-nums">{fmt(shown.amount)}</span>
                    </li>
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    className="btn-secondary text-xs"
                    disabled={preview.busy}
                    onClick={() => void preview.run().catch(() => {})}
                  >
                    Посчитать
                  </button>
                  {shown && (
                    <button
                      className="btn-primary text-xs"
                      disabled={invoice.busy}
                      onClick={() => void invoice.run().catch(() => {})}
                    >
                      Выставить на {fmt(shown.amount)}
                    </button>
                  )}
                </div>
                {!v.billing.connection_paid_at && (
                  <p className="mt-1 text-xs text-muted">
                    Подключение ещё не оплачено — входит в счёт.
                  </p>
                )}
              </div>
            </>
          )}
          {note && <p className="text-muted">{note}</p>}
          <ErrorBox
            error={
              load.error ??
              save.error ??
              action.error ??
              quota.error ??
              preview.error ??
              invoice.error
            }
          />
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
  return (
    <Card title="Адреса">
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
    </Card>
  );
}

function ZernioCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof syncZernioFn>> | null>(null);
  const sync = useAction(async () => {
    setResult(await syncZernioFn({ data: { botId: c.id } }));
    await onDone();
  });
  const zr = useAction(async (ids: string[]) => {
    await setZernioAccountsFn({ data: { botId: c.id, accountIds: ids } });
    await onDone();
  });
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru") : "—");
  const manual = c.zernioAccounts.filter((id) => !c.zernio.accounts.some((a) => a.id === id));
  return (
    <Card
      title="Instagram и WhatsApp (Zernio)"
      actions={
        <button
          className="btn-secondary text-xs"
          disabled={sync.busy}
          onClick={() => void sync.run().catch(() => {})}
        >
          {sync.busy ? "Сверяем…" : c.zernio.profileId ? "Сверить аккаунты" : "Создать профиль"}
        </button>
      }
    >
      <p className="text-xs text-muted">
        Ключ и вебхук Zernio одни на платформу; клиенты различаются профилем. События аккаунтов ниже
        попадают этому клиенту.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Профиль</dt>
        <dd className="font-mono">{c.zernio.profileId ?? "не создан"}</dd>
        <dt className="text-muted">Сверка</dt>
        <dd>{when(c.zernio.syncedAt)}</dd>
        <dt className="text-muted">Последнее событие</dt>
        <dd>{when(c.zernio.lastEventAt)}</dd>
      </dl>
      {c.zernio.accounts.length > 0 && (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Канал</th>
              <th>Аккаунт</th>
              <th>Состояние</th>
              <th>Событие</th>
            </tr>
          </thead>
          <tbody>
            {c.zernio.accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.platform === "whatsapp" ? "WhatsApp" : "Instagram"}</td>
                <td>
                  {a.username ? `@${a.username}` : (a.name ?? "")}{" "}
                  <span className="font-mono text-xs text-muted">{a.id}</span>
                </td>
                <td>
                  {a.expired ? (
                    <Badge tone="danger">отключён</Badge>
                  ) : (
                    <Badge tone="ok">подключён</Badge>
                  )}
                </td>
                <td className="text-muted">{when(a.lastEventAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && result.conflicts.length > 0 && (
        <p className="mt-2 text-xs text-danger">
          Не отданы этому клиенту (уже у другого):{" "}
          {result.conflicts
            .map((x) => `${x.username ? `@${x.username}` : x.id} — ${x.ownerName}`)
            .join(", ")}
        </p>
      )}
      <ErrorBox error={sync.error} />
      <form
        className="mt-4 space-y-3 border-t border-line pt-4"
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
          label="Идентификаторы аккаунтов вручную"
          hint={
            manual.length
              ? `Вне снимка профиля: ${manual.join(", ")}. Аккаунт, записанный у другого клиента, сохранить не даст.`
              : "Обычно не нужно: сверка заполняет список сама. Аккаунт, записанный у другого клиента, сохранить не даст."
          }
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

type CB = Awaited<ReturnType<typeof getClientFn>>["consultant"];
type Limits = { dailyUsd: number | null; dailyCalls: number | null; dailyTests: number | null };

/** Дневной предел ИИ-консультанта: общий по умолчанию, клиенту с большим потоком — свой. */
function ConsultantLimitsCard({
  c,
  budget,
  onDone,
}: {
  c: C;
  budget: CB;
  onDone: () => Promise<void>;
}) {
  const save = useAction(async (limits: Limits | null) => {
    await setConsultantLimitsFn({ data: { botId: c.id, limits } });
    await onDone();
  });
  const { limits, defaults, max, today: t } = budget;
  const num = (f: FormData, k: string) => {
    const v = String(f.get(k) ?? "")
      .trim()
      .replace(",", ".");
    return v === "" ? null : Number(v);
  };
  return (
    <Card title="Предел ИИ-консультанта в день">
      <p className="mb-3 text-sm text-muted">
        Сегодня (UTC): ${t.usd.toFixed(2)} из ${limits.dailyUsd}, ответов {t.calls} из{" "}
        {limits.dailyCalls}, проб {t.tests} из {limits.dailyTests}.{" "}
        {budget.custom ? <Badge tone="warn">свой предел</Badge> : <Badge>общий предел</Badge>}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save
            .run({
              dailyUsd: num(f, "dailyUsd"),
              dailyCalls: num(f, "dailyCalls"),
              dailyTests: num(f, "dailyTests"),
            })
            .catch(() => {});
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Расход, $" hint={`общий ${defaults.dailyUsd}, до ${max.dailyUsd}`}>
            <input
              className="input"
              name="dailyUsd"
              type="number"
              min={0}
              max={max.dailyUsd}
              step="0.5"
              defaultValue={budget.custom ? limits.dailyUsd : ""}
              placeholder={String(defaults.dailyUsd)}
            />
          </Field>
          <Field label="Ответов" hint={`общий ${defaults.dailyCalls}`}>
            <input
              className="input"
              name="dailyCalls"
              type="number"
              min={0}
              max={max.dailyCalls}
              step="1"
              defaultValue={budget.custom ? limits.dailyCalls : ""}
              placeholder={String(defaults.dailyCalls)}
            />
          </Field>
          <Field label="Проб из админки" hint={`общий ${defaults.dailyTests}`}>
            <input
              className="input"
              name="dailyTests"
              type="number"
              min={0}
              max={max.dailyTests}
              step="1"
              defaultValue={budget.custom ? limits.dailyTests : ""}
              placeholder={String(defaults.dailyTests)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Пустое поле — общий предел. 0 — ИИ клиенту выключен. Расход идёт с ключа платформы.
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить предел
          </button>
          {budget.custom && (
            <button
              type="button"
              className="btn-ghost"
              disabled={save.busy}
              onClick={() => void save.run(null).catch(() => {})}
            >
              Вернуть общий
            </button>
          )}
        </div>
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
  const policy = useAction(async (f: FormData) => {
    await setOverduePolicyFn({
      data: {
        botId: c.id,
        on_overdue: String(f.get("on_overdue")) === "suspend" ? "suspend" : "warn",
        warn_days_before: Number(f.get("warn_days_before")),
        grace_days: Number(f.get("grace_days")),
      },
    });
    setNote("Политика сохранена.");
  });
  const confirm = (id: string) => {
    const start = prompt(
      "Начало оплаченного периода (ГГГГ-ММ-ДД):",
      data?.suggested.start ?? today(),
    );
    if (!start) return;
    const end = prompt(
      "Конец периода (ГГГГ-ММ-ДД):",
      start === data?.suggested.start ? data.suggested.end : plusDays(start, 30),
    );
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
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              void policy.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <div className="text-sm font-medium sm:col-span-3">При неоплате</div>
            <select
              className="input"
              name="on_overdue"
              defaultValue={c.subscription.policy.on_overdue}
            >
              <option value="warn">только предупреждать</option>
              <option value="suspend">приостановить после отсрочки</option>
            </select>
            <input
              className="input"
              name="warn_days_before"
              type="number"
              min={0}
              max={60}
              defaultValue={c.subscription.policy.warn_days_before}
              title="За сколько дней предупреждать"
            />
            <input
              className="input"
              name="grace_days"
              type="number"
              min={0}
              max={60}
              defaultValue={c.subscription.policy.grace_days}
              title="Дней отсрочки после истечения"
            />
            <div className="text-xs text-muted sm:col-span-3">
              Предупреждение за N дней до конца и отсрочка после истечения; обход — ежедневно,
              владелец получает сообщение от своего бота.
            </div>
            <div className="sm:col-span-3">
              <button className="btn-secondary" disabled={policy.busy}>
                Сохранить политику
              </button>
            </div>
          </form>
          {note && <p className="text-sm text-muted">{note}</p>}
          <ErrorBox
            error={
              load.error ??
              invoice.error ??
              payment.error ??
              act.error ??
              proof.error ??
              policy.error
            }
          />
        </div>
      )}
    </Card>
  );
}

type History = Awaited<ReturnType<typeof healthHistoryFn>>;

function HealthCard({ c }: { c: C }) {
  const router = useRouter();
  const [history, setHistory] = useState<History | null>(null);
  const load = useAction(async () => setHistory(await healthHistoryFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const snap = useAction(async () => {
    await recordHealthNowFn({ data: { botId: c.id } });
    await router.invalidate();
    await load.run();
  });
  const h = c.health;
  return (
    <Card
      title="Здоровье бота"
      actions={
        h ? (
          <Badge tone={h.ok ? "ok" : "danger"}>
            {h.ok ? "работает" : "сбой"} · {new Date(h.at).toLocaleString("ru")}
          </Badge>
        ) : (
          <Badge>снимков нет</Badge>
        )
      }
    >
      {h && !h.ok && h.error && <p className="mb-2 text-sm text-danger">{h.error}</p>}
      {h?.ok && h.pending ? (
        <p className="mb-2 text-sm text-muted">
          В очереди Telegram {h.pending} обновлений — бот отвечает с задержкой.
        </p>
      ) : null}
      {history && history.snapshotCount > 0 ? (
        <>
          <p className="text-sm">
            Аптайм за 14 дней:{" "}
            <span className="font-medium tabular-nums">
              {Math.round((history.uptimeRatio ?? 0) * 1000) / 10}%
            </span>
            <span className="text-muted"> · {history.snapshotCount} снимков</span>
          </p>
          {history.outages.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Простоев не было.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {history.outages.slice(0, 8).map((o) => (
                <li key={o.startedAt} className="py-1.5">
                  <span className="tabular-nums">{new Date(o.startedAt).toLocaleString("ru")}</span>
                  {" → "}
                  <span className="tabular-nums">
                    {o.endedAt ? new Date(o.endedAt).toLocaleString("ru") : "сейчас"}
                  </span>
                  {o.error && <span className="block text-xs text-muted">{o.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">Снимки пишет крон каждые 15 минут для клиентов на v2.</p>
      )}
      <button
        type="button"
        className="btn-secondary mt-3 text-xs"
        disabled={snap.busy || !c.telegram.connected}
        onClick={() => void snap.run().catch(() => {})}
      >
        Проверить сейчас
      </button>
      <ErrorBox error={load.error ?? snap.error} />
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
