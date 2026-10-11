import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import {
  checkNotifyFn,
  lowStockFn,
  notifyPrefsFn,
  saveLowStockFn,
  saveNotifyPrefsFn,
} from "@/app/admin/notify.functions";
import { NOTIFY_KINDS, URGENT_KINDS, type NotifyPrefs } from "@/core/notify/prefs";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";
import { roleAllows } from "@/core/auth/roles";
import { HelpTip } from "@/app/admin/help-panel";

/**
 * Уведомления продавцу: что и куда приходит, тихие часы, утренний дайджест.
 * Владелец меняет, остальные видят.
 */
export function NotifyCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [data, setData] = useState<Awaited<ReturnType<typeof notifyPrefsFn>> | null>(null);
  const [p, setP] = useState<NotifyPrefs | null>(null);
  const [quietOn, setQuietOn] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void notifyPrefsFn().then((r) => {
      setData(r);
      setP(r.prefs);
      setQuietOn(Boolean(r.prefs.quiet));
    });
  }, []);
  const owner = roleAllows(shop.role, "admin");
  const save = useAction(async () => {
    if (!p) return;
    await saveNotifyPrefsFn({
      data: {
        kinds: Object.fromEntries(
          NOTIFY_KINDS.map((k) => [
            k,
            { ...p.kinds[k], telegram: p.kinds[k].telegram || URGENT_KINDS.includes(k) },
          ]),
        ),
        email: p.email,
        quiet: quietOn ? (p.quiet ?? { from: "22:00", to: "08:00" }) : null,
        digest: p.digest,
      },
    });
    setSaved(true);
  });
  const [check, setCheck] = useState<Awaited<ReturnType<typeof checkNotifyFn>>["lines"] | null>(
    null,
  );
  const runCheck = useAction(async () => {
    setCheck(null);
    setCheck((await checkNotifyFn({ data: { locale: shop.locale } })).lines);
  });
  const setKind = (k: (typeof NOTIFY_KINDS)[number], ch: "telegram" | "email", v: boolean) =>
    p && setP({ ...p, kinds: { ...p.kinds, [k]: { ...p.kinds[k], [ch]: v } } });
  if (!p || !data) return <Card title={t("settings.notify.title")}>…</Card>;
  const quiet = p.quiet ?? { from: "22:00", to: "08:00" };
  return (
    <Card title={t("settings.notify.title")} className="lg:col-span-2">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.notify.intro")}</p>
        <table className="table">
          <thead>
            <tr>
              <th>
                {t("settings.notify.col.event")}{" "}
                <HelpTip article="settings-bots" anchor="notify-kinds" />
              </th>
              <th className="text-center">Telegram</th>
              <th className="text-center">
                {t("settings.notify.col.email")}
                {!data.mail && (
                  <span className="block text-xs font-normal text-muted">
                    {t("settings.notify.col.emailOff")}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {NOTIFY_KINDS.map((k) => {
              const urgent = URGENT_KINDS.includes(k);
              return (
                <tr key={k}>
                  <td>
                    {t(`settings.notify.kind.${k}`)}
                    {urgent && (
                      <span className="ml-2 text-xs text-muted">{t("settings.notify.urgent")}</span>
                    )}
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={p.kinds[k].telegram || urgent}
                      disabled={!owner || urgent}
                      onChange={(e) => setKind(k, "telegram", e.target.checked)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={p.kinds[k].email}
                      disabled={!owner || !data.mail}
                      onChange={(e) => setKind(k, "email", e.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("settings.notify.email")}
            help={<HelpTip article="settings-bots" anchor="notify-email" />}
            hint={data.mail ? t("settings.notify.emailHint") : t("settings.notify.noMail")}
          >
            <input
              className="input"
              type="email"
              value={p.email}
              disabled={!owner || !data.mail}
              onChange={(e) => setP({ ...p, email: e.target.value })}
            />
          </Field>
          <Field
            label={t("settings.notify.quiet")}
            help={<HelpTip article="settings-bots" anchor="notify-quiet" />}
            hint={t("settings.notify.quietHint", { tz: data.timezone })}
          >
            <div className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={quietOn}
                disabled={!owner}
                onChange={(e) => setQuietOn(e.target.checked)}
              />
              <input
                className="input w-28"
                type="time"
                value={quiet.from}
                disabled={!owner || !quietOn}
                onChange={(e) => setP({ ...p, quiet: { ...quiet, from: e.target.value } })}
              />
              —
              <input
                className="input w-28"
                type="time"
                value={quiet.to}
                disabled={!owner || !quietOn}
                onChange={(e) => setP({ ...p, quiet: { ...quiet, to: e.target.value } })}
              />
            </div>
          </Field>
        </div>
        <Field
          label={t("settings.notify.digest")}
          help={<HelpTip article="settings-bots" anchor="notify-digest" />}
          hint={t("settings.notify.digestHint")}
        >
          <div className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.digest.enabled}
              disabled={!owner}
              onChange={(e) => setP({ ...p, digest: { ...p.digest, enabled: e.target.checked } })}
            />
            {t("settings.notify.digestAt")}
            <select
              className="input w-24"
              value={p.digest.hour}
              disabled={!owner || !p.digest.enabled}
              onChange={(e) =>
                setP({ ...p, digest: { ...p.digest, hour: Number(e.target.value) } })
              }
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </Field>
        {owner && (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </form>
      {owner && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-sm text-muted">{t("settings.notify.checkHint")}</p>
          <button
            type="button"
            className="btn-secondary"
            disabled={runCheck.busy}
            onClick={() => void runCheck.run().catch(() => {})}
          >
            {runCheck.busy ? t("settings.notify.checking") : t("settings.notify.check")}
          </button>
          <HelpTip article="settings-bots" anchor="notify-check" />
          <ErrorBox error={runCheck.error} />
          {check && (
            <ul className="space-y-1 text-sm">
              {check.map((l, i) => (
                <li key={i} className={l.ok ? "text-ok" : "text-danger"}>
                  {l.ok ? "✓" : "✗"} {t(`settings.notify.check.ch${CHANNEL_KEY[l.channel]}`)}
                  {l.target && l.channel !== "push" ? ` ${l.target}` : ""}:{" "}
                  {l.code === "ok" && l.channel === "push"
                    ? t("settings.notify.check.pushOk", { n: l.target })
                    : t(`settings.notify.check.${l.code}`)}
                  {l.code === "other" && l.detail ? ` (${l.detail})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

const CHANNEL_KEY = { telegram: "Telegram", email: "Email", push: "Push" } as const;

/**
 * Порог «заканчивается на складе»: когда остаток товара падает до него или
 * ниже, продавцу приходит одно сообщение. У товара может быть свой порог.
 * 0 — не предупреждать. Владелец меняет, остальные видят.
 */
export function LowStockCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [value, setValue] = useState<string | null>(null);
  const [showBuyer, setShowBuyer] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void lowStockFn().then((r) => {
      setValue(String(r.threshold));
      setShowBuyer(r.showToBuyer);
    });
  }, []);
  const owner = roleAllows(shop.role, "admin");
  const save = useAction(async () => {
    await saveLowStockFn({ data: { threshold: Number(value) || 0, showToBuyer: showBuyer } });
    setSaved(true);
  });
  return (
    <Card title={t("settings.lowStock.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.lowStock.intro")}</p>
        <Field
          label={t("settings.lowStock.label")}
          help={<HelpTip article="settings-bots" anchor="low-stock" />}
          hint={t("settings.lowStock.hint")}
        >
          <input
            className="input w-32"
            type="number"
            min={0}
            max={100000}
            value={value ?? ""}
            disabled={!owner || value === null}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={showBuyer}
            disabled={!owner || value === null}
            onChange={(e) => setShowBuyer(e.target.checked)}
          />
          <span>
            {t("settings.lowStock.showBuyer")}{" "}
            <HelpTip article="settings-bots" anchor="low-stock" />
            <span className="block text-xs text-muted">{t("settings.lowStock.showBuyerHint")}</span>
          </span>
        </label>
        {owner && (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy || value === null}>
              {t("common.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
