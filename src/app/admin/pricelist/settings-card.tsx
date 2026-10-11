import { useState } from "react";
import { savePricelistSettingsFn } from "../pricelist.functions";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { type CardProps } from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

/** Настройки прайса. */

export function SettingsCard({ t, data, canEdit, onDone }: CardProps) {
  const [synonyms, setSynonyms] = useState(data.synonyms);
  const [shopUrl, setShopUrl] = useState(data.shopUrl);
  const [store, setStore] = useState(data.store);
  const [followUp, setFollowUp] = useState(data.followUp);
  const [qualityDigest, setQualityDigest] = useState(data.qualityDigest);
  const [taskReminders, setTaskReminders] = useState(data.taskReminders);
  const [hours, setHours] = useState(data.hours);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await savePricelistSettingsFn({
      data: { synonyms, shopUrl, store, followUp, qualityDigest, taskReminders, hours },
    });
    setSaved(true);
    await onDone();
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("pricelist.settings.title")}
          <HelpTip article="pricelist" anchor="settings" />
        </span>
      }
    >
      <div className="space-y-3">
        <Field label={t("pricelist.settings.synonyms")} hint={t("pricelist.settings.synonymsHint")}>
          <textarea
            className="input min-h-32 font-mono text-xs"
            value={synonyms}
            disabled={!canEdit}
            onChange={(e) => setSynonyms(e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.settings.shopUrl")}>
          <input
            className="input"
            value={shopUrl}
            disabled={!canEdit}
            placeholder="https://"
            onChange={(e) => setShopUrl(e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.settings.address")}>
          <input
            className="input"
            value={store.address}
            disabled={!canEdit}
            onChange={(e) => setStore({ ...store, address: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pricelist.settings.phone")}>
            <input
              className="input"
              value={store.phone}
              disabled={!canEdit}
              onChange={(e) => setStore({ ...store, phone: e.target.value })}
            />
          </Field>
          <Field label={t("pricelist.settings.storeHours")}>
            <input
              className="input"
              value={store.hours}
              disabled={!canEdit}
              onChange={(e) => setStore({ ...store, hours: e.target.value })}
            />
          </Field>
        </div>
        <p className="label flex items-center gap-1.5">
          {t("pricelist.settings.workHours")}
          <HelpTip article="pricelist" anchor="work-hours" />
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pricelist.settings.open")}>
            <input
              className="input"
              inputMode="numeric"
              value={String(hours.open)}
              disabled={!canEdit}
              onChange={(e) => setHours({ ...hours, open: Number(e.target.value.trim()) })}
            />
          </Field>
          <Field label={t("pricelist.settings.close")}>
            <input
              className="input"
              inputMode="numeric"
              value={String(hours.close)}
              disabled={!canEdit}
              onChange={(e) => setHours({ ...hours, close: Number(e.target.value.trim()) })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">{t("pricelist.settings.workHoursHint")}</p>
        <p className="text-xs text-muted">
          {t("pricelist.hours", { open: hours.open, close: hours.close })}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={followUp}
            disabled={!canEdit}
            onChange={(e) => setFollowUp(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-1.5">
              {t("pricelist.settings.followUp")}
              <HelpTip article="pricelist" anchor="follow-up" />
            </span>
            <span className="block text-xs text-muted">{t("pricelist.settings.followUpHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={qualityDigest}
            disabled={!canEdit}
            onChange={(e) => setQualityDigest(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-1.5">
              {t("pricelist.settings.digest")}
              <HelpTip article="pricelist" anchor="digest" />
            </span>
            <span className="block text-xs text-muted">{t("pricelist.settings.digestHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={taskReminders}
            disabled={!canEdit}
            onChange={(e) => setTaskReminders(e.target.checked)}
          />
          <span>
            <span className="flex items-center gap-1.5">
              {t("pricelist.settings.taskReminders")}
              <HelpTip article="pricelist" anchor="task-reminders" />
            </span>
            <span className="block text-xs text-muted">
              {t("pricelist.settings.taskRemindersHint")}
            </span>
          </span>
        </label>
        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              {t("pricelist.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("pricelist.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}
