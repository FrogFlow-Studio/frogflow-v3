import { saveWinbackFn, winbackFn } from "@/app/admin/winback.functions";
import { AutoStatsBlock } from "@/app/admin/auto-stats";
import { AutoPreview } from "@/app/admin/auto-preview";
import type { AutoStats } from "@/core/automsg/stats";
import { birthdayFn, funnelFn, saveBirthdayFn, saveFunnelFn } from "@/app/admin/funnel.functions";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saveSettingsFn } from "@/app/admin/settings.functions";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { useT } from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

/** Общий потолок автосообщений (корзина, похожие, возврат, воронка) на покупателя в сутки. */
export function MarketingCapCard({ cap }: { cap: string }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(cap);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { marketing_daily_cap: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.cap.title")} help={<HelpTip article="broadcasts" anchor="cap" />}>
      <p className="mb-3 text-sm text-muted">{t("broadcasts.cap.intro")}</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("broadcasts.cap.perDay")}>
          <input
            className="input w-32"
            type="number"
            min={0}
            max={10}
            step={1}
            value={value}
            placeholder="1"
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

export function CartReminderCard({ hours, stats }: { hours: string; stats?: AutoStats }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(hours);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { cart_reminder_hours: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.cart.title")} help={<HelpTip article="broadcasts" anchor="cart" />}>
      <p className="mb-3 text-sm text-muted">{t("broadcasts.cart.intro")}</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("broadcasts.cart.hours")}>
          <input
            className="input w-32"
            type="number"
            min={0}
            max={720}
            step={1}
            value={value}
            placeholder="6"
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
      <AutoPreview t={t} kind="cart" />
      <AutoStatsBlock t={t} stats={stats} />
    </Card>
  );
}

/** Возвратные продажи: серия из двух сообщений тем, кто давно не заказывал. */
export function WinbackCard({ stats }: { stats?: AutoStats }) {
  const t = useT();
  const [c, setC] = useState<Awaited<ReturnType<typeof winbackFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void winbackFn().then(setC);
  }, []);
  const save = useAction(async () => {
    if (!c) return;
    await saveWinbackFn({ data: c });
    setSaved(true);
  });
  if (!c) return null;
  return (
    <Card
      title={t("broadcasts.winback.title")}
      actions={
        <div className="flex items-center gap-1.5">
          <Switch
            checked={c.enabled}
            onChange={(on) => setC({ ...c, enabled: on })}
            label={t("broadcasts.winback.enabled")}
          />
          <HelpTip article="broadcasts" anchor="winback" />
        </div>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("broadcasts.winback.intro")}</p>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label={t("broadcasts.winback.days1")}>
            <input
              className="input"
              type="number"
              min={3}
              max={365}
              value={c.days1}
              onChange={(e) => setC({ ...c, days1: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("broadcasts.winback.text1")}>
            <textarea
              className="input min-h-16"
              value={c.text1}
              onChange={(e) => setC({ ...c, text1: e.target.value })}
            />
          </Field>
          <Field label={t("broadcasts.winback.days2")}>
            <input
              className="input"
              type="number"
              min={4}
              max={365}
              value={c.days2 ?? ""}
              onChange={(e) =>
                setC({ ...c, days2: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
          <Field label={t("broadcasts.winback.text2")}>
            <textarea
              className="input min-h-16"
              value={c.text2}
              onChange={(e) => setC({ ...c, text2: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label={t("broadcasts.winback.promo")}
          hint={t("broadcasts.winback.promoHint")}
          help={<HelpTip article="broadcasts" anchor="winback" />}
        >
          <input
            className="input w-48 uppercase"
            value={c.promo}
            onChange={(e) => setC({ ...c, promo: e.target.value })}
          />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">✓</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
      <AutoPreview t={t} kind="winback" draft={c} />
      <AutoStatsBlock t={t} stats={stats} />
    </Card>
  );
}

/** Поздравление с днём рождения (core/funnel/birthday). */
export function BirthdayCard() {
  const t = useT();
  const [d, setD] = useState<Awaited<ReturnType<typeof birthdayFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void birthdayFn().then(setD);
  }, []);
  const save = useAction(async () => {
    if (!d) return;
    await saveBirthdayFn({ data: d.cfg });
    setSaved(true);
  });
  if (!d) return null;
  const set = (patch: Partial<typeof d.cfg>) => {
    setSaved(false);
    setD({ ...d, cfg: { ...d.cfg, ...patch } });
  };
  return (
    <Card title={t("birthday.title")}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={d.cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          {t("birthday.enabled")}
          <HelpTip article="broadcasts" anchor="birthday" />
        </label>
        <Field label={t("birthday.text")} hint={t("birthday.textHint")}>
          <textarea
            className="input min-h-20"
            maxLength={2000}
            value={d.cfg.text}
            placeholder={t("birthday.placeholder")}
            onChange={(e) => set({ text: e.target.value })}
          />
        </Field>
        <Field label={t("birthday.promo")} hint={t("birthday.promoHint")}>
          <input
            className="input w-48"
            maxLength={40}
            value={d.cfg.promo}
            onChange={(e) => set({ promo: e.target.value })}
          />
        </Field>
        {d.link && (
          <p className="text-xs text-muted">
            {t("birthday.link")} <code className="rounded bg-surface-2 px-1">{d.link}</code>
          </p>
        )}
        <ErrorBox error={save.error} />
        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
      </div>
    </Card>
  );
}

/** Автоворонка: до 10 сообщений новому покупателю по часам от первого контакта. */
export function FunnelCard() {
  const t = useT();
  const [c, setC] = useState<Awaited<ReturnType<typeof funnelFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void funnelFn().then(setC);
  }, []);
  const save = useAction(async () => {
    if (!c) return;
    await saveFunnelFn({ data: c });
    setSaved(true);
  });
  if (!c) return null;
  const setStep = (i: number, patch: Partial<(typeof c.steps)[number]>) =>
    setC({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Card
      title={t("broadcasts.funnel.title")}
      actions={
        <div className="flex items-center gap-1.5">
          <Switch
            checked={c.enabled}
            onChange={(on) => setC({ ...c, enabled: on })}
            label={t("broadcasts.winback.enabled")}
          />
          <HelpTip article="broadcasts" anchor="funnel" />
        </div>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("broadcasts.funnel.intro")}</p>
        {c.steps.map((s, i) => (
          <div key={i} className="rounded-md border border-line p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              {t("broadcasts.funnel.after")}
              <input
                className="input w-24"
                type="number"
                min={1}
                max={1080}
                value={s.afterHours}
                onChange={(e) => setStep(i, { afterHours: Number(e.target.value) })}
              />
              {t("broadcasts.funnel.hours")}
              <label className="ml-auto flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={s.catalogButton}
                  onChange={(e) => setStep(i, { catalogButton: e.target.checked })}
                />
                {t("broadcasts.funnel.catalogButton")}
                <HelpTip article="broadcasts" anchor="funnel" />
              </label>
              <button
                type="button"
                className="btn-ghost text-xs text-danger"
                onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
            <textarea
              className="input min-h-16"
              value={s.text}
              onChange={(e) => setStep(i, { text: e.target.value })}
            />
          </div>
        ))}
        {c.steps.length < 10 && (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() =>
              setC({
                ...c,
                steps: [
                  ...c.steps,
                  {
                    afterHours: (c.steps[c.steps.length - 1]?.afterHours ?? 0) + 24,
                    text: "",
                    catalogButton: false,
                  },
                ],
              })
            }
          >
            {t("broadcasts.funnel.addStep")}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={c.stopOnOrder}
            onChange={(e) => setC({ ...c, stopOnOrder: e.target.checked })}
          />
          {t("broadcasts.funnel.stopOnOrder")}
          <HelpTip article="broadcasts" anchor="funnel" />
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">✓</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
