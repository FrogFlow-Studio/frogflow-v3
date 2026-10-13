import {
  CHAT_EMAIL_ASK_KEY,
  CHAT_EMAIL_OPTIONAL_KEY,
  emailAskOn,
  emailOptionalOn,
} from "@/core/orders/email-ask";
import { CHAT_RECEIPT_TEXT_KEY, receiptTextOn } from "@/core/receipts/text-receipt";
import {
  CHAT_PAY_FAILED_KEY,
  CHAT_RECEIPT_TEXT_OFFER_KEY,
  payFailedOn,
  receiptTextOfferOn,
} from "@/core/inbox/triage";
import {
  CHAT_UNPAID_NUMBER_KEY,
  RESEND_OLD_CONFIRM_KEY,
  resendOldConfirmOn,
  unpaidNumberOn,
} from "@/core/inbox/pay-chat";
import {
  CHAT_FOREIGN_PAY_KEY,
  CHAT_HOW_TO_BUY_KEY,
  CHAT_PRODUCT_REQUEST_KEY,
  CHAT_SEVERAL_ITEMS_KEY,
  CHAT_SKIP_CHATTER_KEY,
  foreignPayOn,
  howToBuyOn,
  productRequestOn,
  severalItemsOn,
  skipChatterOn,
} from "@/core/inbox/triage";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveSettingsFn, setPdfWatermarkFn } from "@/app/admin/settings.functions";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { SCHOOL_OFFER_RU, SCHOOL_PRIVACY_RU } from "@/app/admin/legal-templates";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import {
  parseWeeklySections,
  serializeWeeklySections,
  WEEKLY_SECTIONS,
  WEEKLY_SECTIONS_KEY,
  type WeeklySection,
} from "@/core/analytics/weekly";
import {
  PAY_REMIND_HOLD_KEY,
  PAY_REMIND_HOURS,
  PAY_REMIND_KEY,
  parsePayRemindHours,
  payRemindHoldOn,
} from "@/core/orders/pay-remind-settings";
import { settingsRoute } from "./route";
import { roleAllows } from "@/core/auth/roles";
import { HelpTip } from "@/app/admin/help-panel";

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
        <HelpTip article="settings-shop" anchor="smart-search" />
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
        <HelpTip article="settings-shop" anchor="watermark" />
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
  const sections = parseWeeklySections(settings[WEEKLY_SECTIONS_KEY]);
  const pick = useAction(async (next: WeeklySection[]) => {
    await saveSettingsFn({ data: { [WEEKLY_SECTIONS_KEY]: serializeWeeklySections(next) } });
    await router.invalidate();
  });
  return (
    <Card title={t("settings.weekly.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.weekly.intro")}</p>
      {/* Консультант без продаж (sellsNow): крон отчёт не шлёт — говорим об этом прямо. */}
      {shop.sells === false && (
        <p className="mb-3 text-sm text-warn">{t("settings.weekly.noSales")}</p>
      )}
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={toggle.busy || !roleAllows(shop.role, "admin")}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.weekly.title")}
        />
        <span className="text-sm">
          {enabled ? t("settings.weekly.on") : t("settings.weekly.off")}
        </span>
        <HelpTip article="settings-shop" anchor="weekly" />
      </div>
      <ErrorBox error={toggle.error} />
      <fieldset className="mt-4" disabled={pick.busy || !roleAllows(shop.role, "admin")}>
        <legend className="mb-2 text-sm text-muted">{t("weekly.sections.intro")}</legend>
        {WEEKLY_SECTIONS.map((x) => (
          <label key={x} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={sections.includes(x)}
              onChange={(e) =>
                void pick
                  .run(e.target.checked ? [...sections, x] : sections.filter((y) => y !== x))
                  .catch(() => {})
              }
            />
            {t(`weekly.section.${x}` as AdminKey)}
          </label>
        ))}
      </fieldset>
      <ErrorBox error={pick.error} />
    </Card>
  );
}

/** Новые автосообщения покупателям (core/marketing/auto-v3): по умолчанию выключены. */
export function AutoMessagesCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const enabled = settings.auto_messages_v3 === "true";
  const toggle = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { auto_messages_v3: v ? "true" : "false" } });
    await router.invalidate();
  });
  return (
    <Card title={t("settings.autoV3.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.autoV3.intro")}</p>
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={toggle.busy || !roleAllows(shop.role, "admin")}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.autoV3.title")}
        />
        <span className="text-sm">
          {enabled ? t("settings.autoV3.on") : t("settings.autoV3.off")}
        </span>
        <HelpTip article="settings-shop" anchor="auto-v3" />
      </div>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/** Служебные уведомления продавцу из Instagram и WhatsApp (core/notify/service-notices): по умолчанию включены. */
export function ServiceNoticesCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const toggle = useAction(async (key: string, v: boolean) => {
    await saveSettingsFn({ data: { [key]: v ? "true" : "false" } });
    await router.invalidate();
  });
  // on: включено, пока значение не "false"; chat_phone_reply наоборот — выключен, пока не "true".
  const rows = [
    { key: "notify_photo_not_receipt", label: "settings.svcNotice.photo", on: true },
    { key: "notify_bot_pause", label: "settings.svcNotice.pause", on: true },
    { key: "notify_chat_phone", label: "settings.svcNotice.phone", on: true },
    { key: "chat_phone_reply", label: "settings.svcNotice.phoneReply", on: false },
  ] as const;
  return (
    <Card title={t("settings.svcNotice.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.svcNotice.intro")}</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <Switch
              checked={r.on ? settings[r.key] !== "false" : settings[r.key] === "true"}
              disabled={toggle.busy || !roleAllows(shop.role, "admin")}
              onChange={(v) => void toggle.run(r.key, v).catch(() => {})}
              label={t(r.label)}
            />
            <span className="text-sm">{t(r.label)}</span>
            <HelpTip article="settings-shop" anchor="service-notices" />
          </div>
        ))}
      </div>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/**
 * Почта после чека в Instagram (core/orders/email-ask): спрашивать ли её и
 * переспрашивать ли, когда покупатель просит «вацап», «сюда».
 */
export function EmailAskCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const on = emailAskOn(settings[CHAT_EMAIL_ASK_KEY], shop.botId);
  const optional = emailOptionalOn(settings[CHAT_EMAIL_OPTIONAL_KEY]);
  const toggle = useAction(async (key: string, v: boolean) => {
    await saveSettingsFn({ data: { [key]: v ? "true" : "false" } });
    await router.invalidate();
  });
  const readOnly = toggle.busy || !roleAllows(shop.role, "admin");
  return (
    <Card title={t("settings.emailAsk.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.emailAsk.intro")}</p>
      <div className="flex items-center gap-3">
        <Switch
          checked={on}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_EMAIL_ASK_KEY, v).catch(() => {})}
          label={t("settings.emailAsk.label")}
        />
        <span className="text-sm">{t("settings.emailAsk.label")}</span>
        <HelpTip article="settings-payment" anchor="email-ask" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={optional}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_EMAIL_OPTIONAL_KEY, v).catch(() => {})}
          label={t("settings.emailOptional.label")}
        />
        <span className="text-sm">{t("settings.emailOptional.label")}</span>
        <HelpTip article="settings-payment" anchor="email-optional" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.emailOptional.hint")}</p>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/** Чек текстом в Instagram/WhatsApp (core/receipts/text-receipt). */
export function ReceiptTextCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const on = receiptTextOn(settings[CHAT_RECEIPT_TEXT_KEY]);
  const toggle = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { [CHAT_RECEIPT_TEXT_KEY]: v ? "true" : "false" } });
    await router.invalidate();
  });
  return (
    <Card title={t("settings.receiptText.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.receiptText.intro")}</p>
      <div className="flex items-center gap-3">
        <Switch
          checked={on}
          disabled={toggle.busy || !roleAllows(shop.role, "admin")}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.receiptText.label")}
        />
        <span className="text-sm">{t("settings.receiptText.label")}</span>
        <HelpTip article="settings-payment" anchor="receipt-text" />
      </div>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/**
 * Напоминание об оплате заказов из бота, Instagram и WhatsApp (core/orders/pay-remind)
 * и «не напоминать по спорным заказам» (обращение или более поздний заказ).
 */
export function PayReminderCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const current = String(parsePayRemindHours(settings[PAY_REMIND_KEY]) ?? "");
  const hold = payRemindHoldOn(settings[PAY_REMIND_HOLD_KEY]);
  const save = useAction(async (key: string, v: string) => {
    await saveSettingsFn({ data: { [key]: v } });
    await router.invalidate();
  });
  const readOnly = save.busy || !roleAllows(shop.role, "admin");
  return (
    <Card title={t("settings.payRemind.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.payRemind.intro")}</p>
      <select
        className="input"
        aria-label={t("settings.payRemind.title")}
        value={current}
        disabled={readOnly}
        onChange={(e) => void save.run(PAY_REMIND_KEY, e.target.value).catch(() => {})}
      >
        <option value="">{t("settings.payRemind.off")}</option>
        {PAY_REMIND_HOURS.map((n) => (
          <option key={n} value={String(n)}>
            {t("settings.payRemind.after", { n })}
          </option>
        ))}
      </select>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={hold}
          disabled={readOnly}
          onChange={(v) => void save.run(PAY_REMIND_HOLD_KEY, v ? "true" : "false").catch(() => {})}
          label={t("settings.payRemindHold.label")}
        />
        <span className="text-sm">{t("settings.payRemindHold.label")}</span>
        <HelpTip article="settings-payment" anchor="pay-remind-hold" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.payRemindHold.hint")}</p>
      <ErrorBox error={save.error} />
    </Card>
  );
}

/**
 * Сообщения без вопроса и оплата из других стран в Instagram/WhatsApp
 * (core/inbox/triage): что это за сообщение, решает модель.
 */
export function DirectTriageCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const chatter = skipChatterOn(settings[CHAT_SKIP_CHATTER_KEY]);
  const foreign = foreignPayOn(settings[CHAT_FOREIGN_PAY_KEY]);
  const howToBuy = howToBuyOn(settings[CHAT_HOW_TO_BUY_KEY]);
  const several = severalItemsOn(settings[CHAT_SEVERAL_ITEMS_KEY]);
  const request = productRequestOn(settings[CHAT_PRODUCT_REQUEST_KEY]);
  const toggle = useAction(async (key: string, v: boolean) => {
    await saveSettingsFn({ data: { [key]: v ? "true" : "false" } });
    await router.invalidate();
  });
  const readOnly = toggle.busy || !roleAllows(shop.role, "admin");
  return (
    <Card title={t("settings.triage.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.triage.intro")}</p>
      <div className="flex items-center gap-3">
        <Switch
          checked={chatter}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_SKIP_CHATTER_KEY, v).catch(() => {})}
          label={t("settings.triage.chatterLabel")}
        />
        <span className="text-sm">{t("settings.triage.chatterLabel")}</span>
        <HelpTip article="settings-channels" anchor="direct-chatter" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.chatterHint")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={foreign}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_FOREIGN_PAY_KEY, v).catch(() => {})}
          label={t("settings.triage.foreignLabel")}
        />
        <span className="text-sm">{t("settings.triage.foreignLabel")}</span>
        <HelpTip article="settings-channels" anchor="direct-foreign-pay" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.foreignHint")}</p>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.kaspiForeign")}</p>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.foreignOrder")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={howToBuy}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_HOW_TO_BUY_KEY, v).catch(() => {})}
          label={t("settings.triage.howToBuyLabel")}
        />
        <span className="text-sm">{t("settings.triage.howToBuyLabel")}</span>
        <HelpTip article="settings-channels" anchor="direct-how-to-buy" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.howToBuyHint")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={several}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_SEVERAL_ITEMS_KEY, v).catch(() => {})}
          label={t("settings.triage.severalLabel")}
        />
        <span className="text-sm">{t("settings.triage.severalLabel")}</span>
        <HelpTip article="settings-channels" anchor="direct-several-items" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.severalHint")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={request}
          disabled={readOnly}
          onChange={(v) => void toggle.run(CHAT_PRODUCT_REQUEST_KEY, v).catch(() => {})}
          label={t("settings.triage.requestLabel")}
        />
        <span className="text-sm">{t("settings.triage.requestLabel")}</span>
        <HelpTip article="settings-channels" anchor="direct-product-request" />
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.triage.requestHint")}</p>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

/**
 * Оплата и чеки в переписке Instagram/WhatsApp (shop/pay-trouble): что
 * написал покупатель, решает модель; по умолчанию всё включено.
 */
export function PayChatCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const toggle = useAction(async (key: string, v: boolean) => {
    await saveSettingsFn({ data: { [key]: v ? "true" : "false" } });
    await router.invalidate();
  });
  const readOnly = toggle.busy || !roleAllows(shop.role, "admin");
  const rows = [
    {
      key: CHAT_PAY_FAILED_KEY,
      on: payFailedOn(settings[CHAT_PAY_FAILED_KEY]),
      label: t("settings.payChat.failedLabel"),
      hint: t("settings.payChat.failedHint"),
      tip: <HelpTip article="settings-payment" anchor="pay-failed" />,
    },
    {
      key: CHAT_RECEIPT_TEXT_OFFER_KEY,
      on: receiptTextOfferOn(settings[CHAT_RECEIPT_TEXT_OFFER_KEY]),
      label: t("settings.payChat.offerLabel"),
      hint: t("settings.payChat.offerHint"),
      tip: <HelpTip article="settings-payment" anchor="receipt-text-offer" />,
    },
    {
      key: CHAT_UNPAID_NUMBER_KEY,
      on: unpaidNumberOn(settings[CHAT_UNPAID_NUMBER_KEY]),
      label: t("settings.payChat.numberLabel"),
      hint: t("settings.payChat.numberHint"),
      tip: <HelpTip article="settings-payment" anchor="unpaid-number" />,
    },
    {
      key: RESEND_OLD_CONFIRM_KEY,
      on: resendOldConfirmOn(settings[RESEND_OLD_CONFIRM_KEY]),
      label: t("settings.payChat.resendLabel"),
      hint: t("settings.payChat.resendHint"),
      tip: <HelpTip article="settings-payment" anchor="resend-old" />,
    },
  ];
  return (
    <Card title={t("settings.payChat.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.payChat.intro")}</p>
      {rows.map((r, i) => (
        <div key={r.key} className={i ? "mt-3" : undefined}>
          <div className="flex items-center gap-3">
            <Switch
              checked={r.on}
              disabled={readOnly}
              onChange={(v) => void toggle.run(r.key, v).catch(() => {})}
              label={r.label}
            />
            <span className="text-sm">{r.label}</span>
            {r.tip}
          </div>
          <p className="mt-1 text-xs text-muted">{r.hint}</p>
        </div>
      ))}
      <ErrorBox error={toggle.error} />
    </Card>
  );
}
