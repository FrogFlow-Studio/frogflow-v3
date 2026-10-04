import { useEffect, useState } from "react";
import { closeGiveawayFn, giveawaysFn, saveGiveawayFn } from "@/app/admin/giveaways.functions";
import type { AdminT } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, useAction } from "@/app/ui";
import { GIVEAWAY_CHANNELS, GIVEAWAY_MAX_WINNERS } from "@/core/giveaways/giveaway";

/** Раздел «Розыгрыши» в «Рассылках» (модуль giveaways): список и форма условий. */
type Loaded = Awaited<ReturnType<typeof giveawaysFn>>;
type Row = Loaded["giveaways"][number];
type Form = {
  id?: string;
  rev?: number;
  title: string;
  prize: string;
  channel: (typeof GIVEAWAY_CHANNELS)[number];
  conditions: string;
  endsAt: string;
  winners: number;
  subscribeChannel: string;
  excludeBlocked: boolean;
  excludeStaff: boolean;
};

/** ISO → значение поля datetime-local (в часовом поясе браузера продавца). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const blank = (): Form => ({
  title: "",
  prize: "",
  channel: "telegram",
  conditions: "",
  endsAt: toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()),
  winners: 1,
  subscribeChannel: "",
  excludeBlocked: true,
  excludeStaff: true,
});

export function GiveawaysCard({ t, locale }: { t: AdminT; locale: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const rows = loaded?.giveaways ?? null;
  const botUsername = loaded?.botUsername ?? null;
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useAction(async () => setLoaded(await giveawaysFn()));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = useAction(async () => {
    if (!form) return;
    const date = new Date(form.endsAt);
    await saveGiveawayFn({
      data: { ...form, endsAt: Number.isNaN(date.getTime()) ? "" : date.toISOString() },
    });
    setSaved(true);
    setForm(null);
    setLoaded(await giveawaysFn());
  });
  const close = useAction(async (id: string) => {
    await closeGiveawayFn({ data: { id } });
    setLoaded(await giveawaysFn());
  });
  const set = (patch: Partial<Form>) => form && setForm({ ...form, ...patch });
  return (
    <Card
      title={t("giveaways.title")}
      actions={
        !form && (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setSaved(false);
              setForm(blank());
            }}
          >
            {t("giveaways.new")}
          </button>
        )
      }
    >
      <p className="mb-3 text-sm text-muted">{t("giveaways.intro")}</p>
      <ErrorBox error={load.error ?? close.error} />
      {form && (
        <form
          className="mb-4 space-y-3 rounded-md border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          <Field label={t("giveaways.f.title")}>
            <input
              className="input"
              maxLength={80}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <Field label={t("giveaways.f.prize")}>
            <input
              className="input"
              maxLength={200}
              value={form.prize}
              onChange={(e) => set({ prize: e.target.value })}
            />
          </Field>
          <Field label={t("giveaways.f.channel")}>
            <select
              className="input"
              value={form.channel}
              onChange={(e) => set({ channel: e.target.value as Form["channel"] })}
            >
              {GIVEAWAY_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`giveaways.channel.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("giveaways.f.conditions")}>
            <textarea
              className="input min-h-20"
              maxLength={1000}
              value={form.conditions}
              onChange={(e) => set({ conditions: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("giveaways.f.endsAt")}>
              <input
                className="input"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => set({ endsAt: e.target.value })}
              />
            </Field>
            <Field label={t("giveaways.f.winners")}>
              <input
                className="input"
                type="number"
                min={1}
                max={GIVEAWAY_MAX_WINNERS}
                value={form.winners}
                onChange={(e) => set({ winners: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label={t("giveaways.f.subscribe")} hint={t("giveaways.f.subscribeHint")}>
            <input
              className="input"
              placeholder="@my_channel"
              maxLength={33}
              value={form.subscribeChannel}
              onChange={(e) => set({ subscribeChannel: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.excludeBlocked}
              onChange={(e) => set({ excludeBlocked: e.target.checked })}
            />
            {t("giveaways.f.excludeBlocked")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.excludeStaff}
              onChange={(e) => set({ excludeStaff: e.target.checked })}
            />
            {t("giveaways.f.excludeStaff")}
          </label>
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
              {t("giveaways.cancelEdit")}
            </button>
          </div>
          <ErrorBox error={save.error} />
        </form>
      )}
      {saved && !form && <p className="mb-2 text-xs text-ok">{t("giveaways.saved")}</p>}
      {rows && rows.length === 0 && !form && <Empty>{t("giveaways.empty")}</Empty>}
      <ul className="space-y-2">
        {rows?.map((g) => (
          <li key={g.id} className="rounded-md border border-line p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b>{g.title}</b>
              <Badge tone={g.status === "open" ? "ok" : "neutral"}>
                {t(`giveaways.status.${g.status}`)}
              </Badge>
              <span className="text-xs text-muted">{t(`giveaways.channel.${g.channel}`)}</span>
            </div>
            <div className="mt-1 text-muted">{g.prize}</div>
            <div className="mt-1 text-xs text-muted">
              {t("giveaways.until", { date: new Date(g.endsAt).toLocaleString(locale) })} ·{" "}
              {t("giveaways.winnersN", { n: g.winners })}
            </div>
            {g.status === "open" && g.channel !== "instagram" && botUsername && (
              <div className="mt-1 text-xs">
                {t("giveaways.link")}:{" "}
                <code className="select-all break-all">{`https://t.me/${botUsername}?start=gw_${g.id}`}</code>
              </div>
            )}
            {g.status === "open" && (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setSaved(false);
                    setForm({ ...g, endsAt: toLocalInput(g.endsAt) });
                  }}
                >
                  {t("giveaways.edit")}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={close.busy}
                  onClick={() => void close.run(g.id).catch(() => {})}
                >
                  {t("giveaways.close")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Выбор розыгрыша для кнопки «Участвовать» под рассылкой (Telegram). */
export function GiveawayButtonPick({
  t,
  value,
  onChange,
}: {
  t: AdminT;
  value: string;
  onChange: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void giveawaysFn()
      .then((r) => setRows(r.giveaways))
      .catch(() => {});
  }, []);
  const open = rows.filter((g) => g.status === "open" && g.channel !== "instagram");
  if (open.length === 0) return null;
  return (
    <Field label={t("giveaways.broadcastButton")}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("giveaways.broadcastNone")}</option>
        {open.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </select>
    </Field>
  );
}
