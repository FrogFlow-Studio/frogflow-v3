import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveSettingsFn } from "@/app/admin/admin.functions";
import {
  addVipManualFn,
  connectVipBotFn,
  deleteVipTariffFn,
  disconnectVipBotFn,
  runVipCronFn,
  saveVipTariffFn,
  vipProofUrlFn,
  vipStateFn,
  vipSubscriptionActionFn,
} from "@/app/admin/vip.functions";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/vip")({
  loader: () => vipStateFn(),
  component: VipPage,
});

type State = Awaited<ReturnType<typeof vipStateFn>>;
type Tariff = State["tariffs"][number];
type Sub = State["subscriptions"][number];

const STATUS: Record<string, { key: AdminKey; tone: "ok" | "warn" | "neutral" | "danger" }> = {
  active: { key: "vip.status.active", tone: "ok" },
  pending_payment: { key: "vip.status.pending_payment", tone: "warn" },
  expired: { key: "vip.status.expired", tone: "neutral" },
  cancelled: { key: "vip.status.cancelled", tone: "danger" },
};

const fmt = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale) : "—";

function VipPage() {
  const state = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  return (
    <>
      <PageTitle title={t("vip.title")} subtitle={t("vip.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BotCard state={state} t={t} />
        <SettingsCard state={state} t={t} />
        <TariffsCard state={state} t={t} />
        <SubscribersCard state={state} t={t} locale={intlLocale(shop.locale)} />
      </div>
    </>
  );
}

function BotCard({ state, t }: { state: State; t: AdminT }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const connect = useAction(async (token: string) => {
    const r = await connectVipBotFn({ data: { token } });
    setNote(
      r.webhook.ok
        ? t("vip.bot.connected", { username: r.username ?? "" })
        : t("vip.bot.webhookFailed", { error: r.webhook.error ?? t("vip.bot.unknownError") }),
    );
    await router.invalidate();
  });
  const disconnect = useAction(async () => {
    if (!confirm(t("vip.bot.disconnectConfirm", { username: state.bot.username ?? "" }))) return;
    const r = await disconnectVipBotFn();
    setNote(t("vip.bot.disconnected", { username: r.username ?? "" }));
    await router.invalidate();
  });
  const ok = state.bot.connected && state.bot.webhookOk;
  return (
    <Card
      title={t("vip.bot.title")}
      actions={
        state.bot.connected ? (
          <Badge tone={ok ? "ok" : "warn"}>
            {ok
              ? t("vip.bot.working", { username: state.bot.username ?? "" })
              : t("vip.bot.checkWebhook")}
          </Badge>
        ) : (
          <Badge>{t("vip.bot.notConnected")}</Badge>
        )
      }
    >
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t("vip.bot.step1")}</li>
        <li>{t("vip.bot.step2")}</li>
        <li>{t("vip.bot.step3")}</li>
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
          placeholder={
            state.bot.connected ? t("vip.bot.newTokenPlaceholder") : t("vip.bot.tokenPlaceholder")
          }
          autoComplete="off"
          required
        />
        <button className="btn-primary shrink-0" disabled={connect.busy}>
          {state.bot.connected ? t("vip.bot.replace") : t("vip.bot.connect")}
        </button>
      </form>
      {state.bot.connected && (
        <button
          className="btn-secondary mt-3 text-xs"
          disabled={disconnect.busy}
          onClick={() => void disconnect.run().catch(() => {})}
        >
          {t("vip.bot.disconnect")}
        </button>
      )}
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      <ErrorBox error={connect.error ?? disconnect.error} />
    </Card>
  );
}

function SettingsCard({ state, t }: { state: State; t: AdminT }) {
  const router = useRouter();
  const s = state.settings;
  const [test, setTest] = useState(s.testMode);
  const [auto, setAuto] = useState(s.autoConfirm);
  const [saved, setSaved] = useState(false);
  const [cron, setCron] = useState<string | null>(null);
  const save = useAction(async (f: FormData) => {
    await saveSettingsFn({
      data: {
        vip_group_id: String(f.get("group_id") ?? "").trim(),
        vip_warn_days: String(f.get("warn_days") ?? "3"),
        vip_warn_days_2: String(f.get("warn_days_2") ?? "1"),
        vip_test_mode: test ? "true" : "false",
        vip_auto_confirm: auto ? "true" : "false",
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
      t("vip.settings.cronResult", {
        warned: r.warned,
        warned2: r.warned2,
        expired: r.expired,
        kickFailed: r.kickFailed,
      }) + (r.errors.length ? `\n${r.errors.join("\n")}` : ""),
    );
  });
  const unit = test ? t("vip.settings.unitMin") : t("vip.settings.unitDays");
  return (
    <Card title={t("vip.settings.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field label={t("vip.settings.groupId")} hint={t("vip.settings.groupIdHint")}>
          <input className="input" name="group_id" defaultValue={s.groupId} placeholder="-100…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("vip.settings.warn1", { unit })}>
            <input
              className="input"
              name="warn_days"
              type="number"
              min={1}
              defaultValue={s.warnDays}
            />
          </Field>
          <Field label={t("vip.settings.warn2", { unit })} hint={t("vip.settings.warn2Hint")}>
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
          <Switch checked={test} onChange={setTest} label={t("vip.settings.testMode")} />
          <span className="text-sm">{test ? t("vip.settings.on") : t("vip.settings.off")}</span>
        </div>
        <div>
          <Switch checked={auto} onChange={setAuto} label={t("vip.settings.autoConfirm")} />
          <p className="mt-1 text-sm text-muted">{t("vip.settings.autoConfirmHint")}</p>
          {auto && !state.autoCheckReady && (
            <p className="mt-1 text-sm text-warn">{t("vip.settings.autoConfirmUnavailable")}</p>
          )}
        </div>
        <Field label={t("vip.settings.welcome")}>
          <input className="input" name="welcome" defaultValue={s.welcome} />
        </Field>
        <Field label={t("vip.settings.instructions")} hint={t("vip.settings.instructionsHint")}>
          <textarea className="input" name="instructions" rows={3} defaultValue={s.instructions} />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-sm text-ok">{t("vip.settings.saved")}</span>}
          <button
            type="button"
            className="btn-secondary"
            disabled={run.busy || !state.bot.connected}
            onClick={() => void run.run().catch(() => {})}
          >
            {t("vip.settings.runCron")}
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

function TariffsCard({ state, t }: { state: State; t: AdminT }) {
  const router = useRouter();
  const [editing, setEditing] = useState<(typeof EMPTY_TARIFF & { id?: string }) | null>(null);
  const save = useAction(async (tariff: NonNullable<typeof editing>) => {
    await saveVipTariffFn({ data: tariff });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("vip.tariffs.deleteConfirm"))) return;
    await deleteVipTariffFn({ data: { id } });
    await router.invalidate();
  });
  const edit = (tariff: Tariff) =>
    setEditing({
      id: tariff.id,
      name: tariff.name,
      description: tariff.description ?? "",
      price: Number(tariff.price),
      currency: tariff.currency,
      duration_days: tariff.duration_days,
      duration_minutes: tariff.duration_minutes ?? 5,
      is_active: tariff.is_active,
      is_public: tariff.is_public,
      is_entry: tariff.is_entry,
      sort_order: tariff.sort_order,
    });
  const link = (tariff: Tariff) =>
    state.bot.username ? `https://t.me/${state.bot.username}?start=t_${tariff.id}` : null;
  return (
    <Card
      title={t("vip.tariffs.title")}
      actions={
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setEditing({ ...EMPTY_TARIFF })}
        >
          {t("vip.tariffs.new")}
        </button>
      }
      className="lg:col-span-2"
    >
      <p className="mb-3 text-sm text-muted">{t("vip.tariffs.intro")}</p>
      {state.tariffs.length === 0 ? (
        <Empty>{t("vip.tariffs.empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("vip.tariffs.col.tariff")}</th>
                <th>{t("vip.tariffs.col.price")}</th>
                <th>{t("vip.tariffs.col.duration")}</th>
                <th>{t("vip.tariffs.col.type")}</th>
                <th>{t("vip.tariffs.col.link")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.tariffs.map((tariff) => (
                <tr key={tariff.id} className={tariff.is_active ? "" : "opacity-60"}>
                  <td>
                    <span className="font-medium">{tariff.name}</span>
                    {!tariff.is_active && <Badge>{t("vip.tariffs.off")}</Badge>}
                  </td>
                  <td className="tabular-nums">
                    {Number(tariff.price)} {tariff.currency}
                  </td>
                  <td className="tabular-nums">
                    {t("vip.tariffs.days", { n: tariff.duration_days })}
                    {tariff.duration_minutes
                      ? ` ${t("vip.tariffs.testMinutes", { n: tariff.duration_minutes })}`
                      : ""}
                  </td>
                  <td>
                    {tariff.is_entry ? (
                      <Badge tone="accent">{t("vip.tariffs.entry")}</Badge>
                    ) : tariff.is_public ? (
                      t("vip.tariffs.public")
                    ) : (
                      <Badge tone="warn">{t("vip.tariffs.hidden")}</Badge>
                    )}
                  </td>
                  <td className="max-w-[16rem] truncate text-xs text-muted">
                    {link(tariff) ?? t("vip.tariffs.connectBot")}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => edit(tariff)}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs text-danger"
                      disabled={del.busy}
                      onClick={() => void del.run(tariff.id).catch(() => {})}
                    >
                      {t("common.delete")}
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
          <Field label={t("vip.tariffs.form.name")}>
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
            />
          </Field>
          <Field label={t("vip.tariffs.form.description")}>
            <input
              className="input"
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <Field label={t("vip.tariffs.form.price")}>
            <input
              className="input"
              type="number"
              min={0}
              value={editing.price}
              onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("vip.tariffs.form.currency")}>
            <input
              className="input"
              value={editing.currency}
              maxLength={3}
              onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label={t("vip.tariffs.form.days")}>
            <input
              className="input"
              type="number"
              min={1}
              value={editing.duration_days}
              onChange={(e) => setEditing({ ...editing, duration_days: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("vip.tariffs.form.testMinutes")}>
            <input
              className="input"
              type="number"
              min={1}
              value={editing.duration_minutes ?? 5}
              onChange={(e) => setEditing({ ...editing, duration_minutes: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("vip.tariffs.form.order")}>
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
              label={t("vip.tariffs.form.active")}
            />
            <Switch
              checked={editing.is_public}
              onChange={(v) => setEditing({ ...editing, is_public: v })}
              label={t("vip.tariffs.form.public")}
            />
            <Switch
              checked={editing.is_entry}
              onChange={(v) => setEditing({ ...editing, is_entry: v })}
              label={t("vip.tariffs.form.entry")}
            />
          </div>
          <div className="flex gap-2 md:col-span-2">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
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

function SubscribersCard({ state, t, locale }: { state: State; t: AdminT; locale: string }) {
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
    setNote(r.warning ? t("vip.subs.addedWarning", { warning: r.warning }) : t("vip.subs.added"));
    await router.invalidate();
  });
  const proof = useAction(async (id: string) => {
    const r = await vipProofUrlFn({ data: { id } });
    if (r.url) window.open(r.url, "_blank", "noopener");
    else setNote(t("vip.subs.noProof"));
  });
  const rows = state.subscriptions.filter((s) => {
    if (status !== "all" && s.status !== status) return false;
    const needle = q.trim().toLowerCase();
    return (
      !needle ||
      who(s).toLowerCase().includes(needle) ||
      String(s.telegram_id).includes(needle) ||
      (s.tariff?.name ?? "").toLowerCase().includes(needle)
    );
  });
  const extend = (s: Sub) => {
    const raw = prompt(t("vip.subs.extendPrompt"), "30");
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days === 0) return;
    void act.run({ id: s.id, action: "extend", days }).catch(() => {});
  };
  const reject = (s: Sub) => {
    const n = prompt(t("vip.subs.rejectPrompt"), "") ?? undefined;
    void act.run({ id: s.id, action: "reject", note: n || undefined }).catch(() => {});
  };
  const pending = state.subscriptions.filter((s) => s.status === "pending_payment").length;
  return (
    <Card
      title={t("vip.subs.title")}
      actions={
        pending > 0 ? (
          <Badge tone="warn">{t("vip.subs.pendingCount", { n: pending })}</Badge>
        ) : undefined
      }
      className="lg:col-span-2"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">{t("vip.subs.filter.all")}</option>
          <option value="pending_payment">{t("vip.subs.filter.pending")}</option>
          <option value="active">{t("vip.subs.filter.active")}</option>
          <option value="expired">{t("vip.subs.filter.expired")}</option>
          <option value="cancelled">{t("vip.subs.filter.cancelled")}</option>
        </select>
        <input
          className="input w-64"
          placeholder={t("vip.subs.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <Empty>{t("vip.subs.empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("vip.subs.col.member")}</th>
                <th>{t("vip.subs.col.tariff")}</th>
                <th>{t("vip.subs.col.status")}</th>
                <th>{t("vip.subs.col.until")}</th>
                <th>{t("vip.subs.col.proof")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = STATUS[s.status];
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="font-medium">{who(s)}</span>
                      <span className="block text-xs text-muted">
                        id {s.telegram_id}
                        {s.imported ? ` · ${t("vip.subs.manual")}` : ""}
                      </span>
                    </td>
                    <td>
                      {s.tariff
                        ? `${s.tariff.name} · ${Number(s.tariff.price)} ${s.tariff.currency}`
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={st?.tone ?? "neutral"}>{st ? t(st.key) : s.status}</Badge>
                      {s.admin_note?.startsWith("warned") && (
                        <span className="block text-xs text-muted">{t("vip.subs.reminded")}</span>
                      )}
                    </td>
                    <td className="tabular-nums text-xs">
                      {s.status === "pending_payment"
                        ? fmt(s.created_at, locale)
                        : fmt(s.expires_at, locale)}
                    </td>
                    <td>
                      {s.has_proof ? (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => void proof.run(s.id).catch(() => {})}
                        >
                          {t("vip.subs.open")}
                        </button>
                      ) : (
                        <span className="text-xs text-muted">{t("common.no")}</span>
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
                            {t("vip.subs.confirm")}
                          </button>{" "}
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() => reject(s)}
                          >
                            {t("vip.subs.reject")}
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
                            {t("vip.subs.extend")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={act.busy}
                            onClick={() =>
                              void act.run({ id: s.id, action: "resend" }).catch(() => {})
                            }
                          >
                            {t("vip.subs.resend")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs text-danger"
                            disabled={act.busy}
                            onClick={() =>
                              confirm(t("vip.subs.excludeConfirm")) &&
                              void act.run({ id: s.id, action: "exclude" }).catch(() => {})
                            }
                          >
                            {t("vip.subs.exclude")}
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
                          {t("vip.subs.prolong")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost text-xs text-danger"
                        disabled={act.busy}
                        onClick={() =>
                          confirm(t("vip.subs.deleteConfirm")) &&
                          void act.run({ id: s.id, action: "delete" }).catch(() => {})
                        }
                      >
                        {t("common.delete")}
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
        <div className="md:col-span-4 text-sm font-medium">{t("vip.subs.add.title")}</div>
        <Field label={t("vip.subs.add.telegramId")}>
          <input className="input" name="telegram_id" type="number" min={1} required />
        </Field>
        <Field label={t("vip.subs.add.tariff")}>
          <select className="input" name="tariff_id" required>
            {state.tariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("vip.subs.add.days")}>
          <input className="input" name="days" type="number" min={1} />
        </Field>
        <Field label={t("vip.subs.add.status")}>
          <select className="input" name="status" defaultValue="active">
            <option value="active">{t("vip.subs.add.statusActive")}</option>
            <option value="expired">{t("vip.subs.add.statusExpired")}</option>
          </select>
        </Field>
        <div className="md:col-span-4">
          <button className="btn-secondary" disabled={add.busy || state.tariffs.length === 0}>
            {t("vip.subs.add.submit")}
          </button>
        </div>
      </form>
    </Card>
  );
}
