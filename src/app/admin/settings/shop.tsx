import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveSettingsFn, setPdfWatermarkFn } from "@/app/admin/admin.functions";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { SCHOOL_OFFER_RU, SCHOOL_PRIVACY_RU } from "@/app/admin/legal-templates";
import { adminT } from "@/app/i18n/admin";
import {
  PAY_REMIND_HOURS,
  PAY_REMIND_KEY,
  parsePayRemindHours,
} from "@/core/orders/pay-remind-settings";
import { settingsRoute } from "./route";

export function LegalCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        legal_offer: String(f.get("legal_offer")),
        legal_privacy: String(f.get("legal_privacy")),
        legal_requisites: String(f.get("legal_requisites")),
        legal_about: String(f.get("legal_about")),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const docs = [
    ["legal_offer", t("settings.legal.offer")],
    ["legal_privacy", t("settings.legal.privacy")],
    ["legal_requisites", t("settings.legal.requisites")],
    ["legal_about", t("settings.legal.about")],
  ] as const;
  return (
    <Card title={t("settings.legal.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.legal.intro", { path: shop.slug ? ` /s/${shop.slug}/legal/…` : "" })}
      </p>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        {docs.map(([k, title]) => (
          <Field key={k} label={title}>
            <textarea id={k} className="input" name={k} rows={5} defaultValue={settings[k] ?? ""} />
            {(k === "legal_offer" || k === "legal_privacy") && (
              <button
                type="button"
                className="mt-1 text-xs text-accent hover:underline"
                onClick={() => {
                  const el = document.getElementById(k) as HTMLTextAreaElement | null;
                  if (!el) return;
                  if (el.value.trim() && !window.confirm(t("settings.legal.templateReplace")))
                    return;
                  el.value = k === "legal_offer" ? SCHOOL_OFFER_RU : SCHOOL_PRIVACY_RU;
                }}
              >
                {t("settings.legal.templateSchool")}
              </button>
            )}
          </Field>
        ))}
        <p className="text-xs text-muted md:col-span-2">{t("settings.legal.templateHint")}</p>
        <div className="flex items-center gap-3 md:col-span-2">
          <button className="btn-secondary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

export function SmartSearchCard({
  settings,
  hasKey,
}: {
  settings: Record<string, string>;
  hasKey: boolean;
}) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const enabled = settings.smart_search_enabled === "true";
  const toggle = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { smart_search_enabled: v ? "true" : "false" } });
    await router.invalidate();
  });
  const today = new Date().toISOString().slice(0, 10);
  const [d, n] = (settings.smart_search_daily_count ?? "").split(":");
  const todayCount = d === today ? Number(n) || 0 : 0;
  const spend = (raw: string | undefined) => {
    try {
      const p = JSON.parse(raw || "{}") as { count?: number; usd?: number; date?: string };
      return { count: Number(p.count) || 0, usd: Number(p.usd) || 0, date: p.date };
    } catch {
      return { count: 0, usd: 0, date: undefined };
    }
  };
  const daily = spend(settings.smart_search_daily_spend);
  const life = spend(settings.smart_search_lifetime_spend);
  return (
    <Card title={t("settings.ss.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.ss.intro")}</p>
      {!hasKey && (
        <p className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("settings.ss.noKey")}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={toggle.busy || !hasKey}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.ss.enable")}
        />
        <span className="text-sm">{enabled ? t("settings.ss.on") : t("settings.ss.off")}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">{t("settings.ss.todayCalls")}</dt>
        <dd className="tabular-nums">{todayCount} / 200</dd>
        <dt className="text-muted">{t("settings.ss.todaySpend")}</dt>
        <dd className="tabular-nums">
          {daily.date === today ? `$${daily.usd.toFixed(4)}` : "$0.0000"}
        </dd>
        <dt className="text-muted">{t("settings.ss.totalSpend")}</dt>
        <dd className="tabular-nums">
          {t("settings.ss.spendFor", { usd: life.usd.toFixed(4), n: life.count })}
        </dd>
      </dl>
      {settings.smart_search_last_error && (
        <p className="mt-3 text-xs text-danger">
          {t("settings.ss.lastError", { error: settings.smart_search_last_error })}
        </p>
      )}
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/** Водяной знак на выдаваемых PDF: кто купил и номер заказа на каждой странице. */
export function WatermarkCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const toggle = useAction(async (v: boolean) => {
    await setPdfWatermarkFn({ data: { enabled: v } });
    await router.invalidate();
  });
  return (
    <Card title={t("settings.watermark.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.watermark.intro")}</p>
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={toggle.busy}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.watermark.switch")}
        />
        <span className="text-sm">
          {enabled ? t("settings.watermark.on") : t("settings.watermark.off")}
        </span>
      </div>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/** Недельный отчёт в бот магазина (core/analytics/weekly): по умолчанию включён. */
export function WeeklyReportCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const enabled = settings.weekly_report_enabled !== "false";
  const toggle = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { weekly_report_enabled: v ? "true" : "false" } });
    await router.invalidate();
  });
  return (
    <Card title={t("settings.weekly.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.weekly.intro")}</p>
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={toggle.busy || shop.role !== "owner"}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.weekly.title")}
        />
        <span className="text-sm">
          {enabled ? t("settings.weekly.on") : t("settings.weekly.off")}
        </span>
      </div>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/** Напоминание об оплате заказов из бота, Instagram и WhatsApp (core/orders/pay-remind). */
export function PayReminderCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const current = String(parsePayRemindHours(settings[PAY_REMIND_KEY]) ?? "");
  const save = useAction(async (v: string) => {
    await saveSettingsFn({ data: { [PAY_REMIND_KEY]: v } });
    await router.invalidate();
  });
  return (
    <Card title={t("settings.payRemind.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.payRemind.intro")}</p>
      <select
        className="input"
        aria-label={t("settings.payRemind.title")}
        value={current}
        disabled={save.busy || shop.role !== "owner"}
        onChange={(e) => void save.run(e.target.value).catch(() => {})}
      >
        <option value="">{t("settings.payRemind.off")}</option>
        {PAY_REMIND_HOURS.map((n) => (
          <option key={n} value={String(n)}>
            {t("settings.payRemind.after", { n })}
          </option>
        ))}
      </select>
      <ErrorBox error={save.error} />
    </Card>
  );
}
