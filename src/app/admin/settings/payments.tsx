import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  deletePaymentMethodFn,
  savePaymentMethodFn,
  saveSettingsFn,
  settingsFn,
} from "@/app/admin/settings.functions";
import { Badge, Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { adminT } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
import { RECEIPT_SNO, RECEIPT_TAX } from "@/core/payments/receipt";
import { imagePath } from "@/core/catalog/image-url";
import { settingsRoute } from "./route";
import { HelpTip } from "@/app/admin/help-panel";

type Method = Awaited<ReturnType<typeof settingsFn>>["methods"][number];

export function PaymentMethods({
  methods,
  settings,
}: {
  methods: Method[];
  settings: Record<string, string>;
}) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  // Цены во всех валютах оплаты (core/pricing/all-prices): «1500 ₸ / 490 ₽» в карточке.
  const allPrices = settings.card_all_prices === "true";
  const toggleAll = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { card_all_prices: v ? "true" : "false" } });
    await router.invalidate();
  });
  const [editing, setEditing] = useState<Method | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    await savePaymentMethodFn({
      data: {
        id,
        countryCode: String(f.get("countryCode")).toUpperCase(),
        countryName: String(f.get("countryName")),
        currency: String(f.get("currency")).toUpperCase(),
        instructions: String(f.get("instructions")),
        qrCodePath: String(f.get("qrCodePath")) || null,
        isActive: f.get("isActive") === "on",
        sortOrder: Number(f.get("sortOrder")) || 0,
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("settings.pay.deleteConfirm"))) return;
    await deletePaymentMethodFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  const [qr, setQr] = useState<string | null>(null);
  return (
    <Card
      title={t("settings.pay.title")}
      actions={
        <button
          className="btn-secondary text-xs"
          onClick={() => {
            setQr(null);
            setEditing("new");
          }}
        >
          {t("settings.pay.addCountry")}
        </button>
      }
    >
      <p className="mb-3 text-xs text-muted">{t("settings.pay.intro")}</p>
      <ul className="divide-y divide-line">
        {methods.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <span className="font-medium">{m.country_name}</span>{" "}
              <span className="text-muted">
                {m.country_code} · {m.currency}
              </span>{" "}
              {!m.is_active && <Badge>{t("settings.off")}</Badge>}
              <div className="line-clamp-1 text-xs text-muted">{m.instructions}</div>
            </div>
            <div className="shrink-0">
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  setQr(m.qr_code_path);
                  setEditing(m);
                }}
              >
                {t("common.edit")}
              </button>
              <button
                className="btn-ghost text-xs text-danger"
                onClick={() => void del.run(m.id).catch(() => {})}
              >
                {t("common.delete")}
              </button>
            </div>
          </li>
        ))}
        {methods.length === 0 && (
          <li className="py-3 text-sm text-muted">{t("settings.pay.empty")}</li>
        )}
      </ul>
      <ErrorBox error={del.error} />
      <div className="mt-3 flex items-start gap-3 border-t border-line pt-3">
        <Switch
          checked={allPrices}
          disabled={toggleAll.busy}
          onChange={(v) => void toggleAll.run(v).catch(() => {})}
          label={t("settings.pay.allPrices")}
        />
        <div>
          <div className="flex items-center gap-2 text-sm">
            {t("settings.pay.allPrices")}
            <HelpTip article="settings-money" anchor="all-prices" />
          </div>
          <p className="text-xs text-muted">{t("settings.pay.allPricesHint")}</p>
        </div>
      </div>
      <ErrorBox error={toggleAll.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("settings.pay.countryCode")}>
              <input
                className="input"
                name="countryCode"
                defaultValue={cur?.country_code ?? ""}
                placeholder="KZ"
                required
                maxLength={8}
              />
            </Field>
            <Field label={t("settings.name")}>
              <input
                className="input"
                name="countryName"
                defaultValue={cur?.country_name ?? ""}
                placeholder={t("settings.pay.countryPlaceholder")}
                required
              />
            </Field>
            <Field label={t("settings.pay.currency")}>
              <input
                className="input"
                name="currency"
                defaultValue={cur?.currency ?? "KZT"}
                maxLength={3}
                required
              />
            </Field>
          </div>
          <Field label={t("settings.pay.instructions")} hint={t("settings.pay.instructionsHint")}>
            <textarea
              className="input"
              name="instructions"
              rows={4}
              defaultValue={cur?.instructions ?? ""}
              required
            />
          </Field>
          <Field label={t("settings.pay.qr")}>
            <input type="hidden" name="qrCodePath" value={qr ?? ""} />
            <div className="flex items-center gap-3">
              {qr && (
                <img
                  src={imagePath(shop.botId, qr)}
                  alt="QR"
                  className="h-16 w-16 rounded border border-line object-cover"
                />
              )}
              <label className="btn-secondary cursor-pointer text-xs">
                {qr ? t("settings.pay.qrReplace") : t("settings.pay.qrUpload")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const key = await uploadFile("image", file, t, (status) =>
                      t("product.uploadFailed", { status }),
                    ).catch(() => null);
                    if (key) setQr(key);
                  }}
                />
              </label>
              {qr && (
                <button type="button" className="btn-ghost text-xs" onClick={() => setQr(null)}>
                  {t("settings.pay.qrRemove")}
                </button>
              )}
            </div>
          </Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
              {t("settings.pay.active")}{" "}
              <HelpTip article="settings-money" anchor="payment-methods" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              {t("settings.order")}{" "}
              <input
                className="input w-20"
                name="sortOrder"
                type="number"
                defaultValue={cur?.sort_order ?? methods.length}
              />
            </label>
          </div>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Telegram Stars: курс «1 ⭐ = X в валюте магазина»; без курса кнопка оплаты не показывается. */
export function StarsCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({ data: { stars_rate: String(f.get("rate")).trim().replace(",", ".") } });
    setSaved(true);
    await router.invalidate();
  });
  const currency = (settings.shop_currency ?? "KZT").toUpperCase();
  return (
    <Card title={t("settings.stars.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.stars.intro")}</p>
        <Field
          label={t("settings.stars.rate", { currency })}
          help={<HelpTip article="settings-payment" anchor="stars" />}
          hint={t("settings.stars.rateHint")}
        >
          <input
            className="input w-40"
            name="rate"
            inputMode="decimal"
            defaultValue={settings.stars_rate ?? ""}
            placeholder="6.5"
          />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

export function RobokassaCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        robokassa_enabled: f.get("enabled") === "on" ? "true" : "false",
        robokassa_test_mode: f.get("test") === "on" ? "true" : "false",
        robokassa_login: String(f.get("login")).trim(),
        robokassa_pass1: String(f.get("pass1")).trim(),
        robokassa_pass2: String(f.get("pass2")).trim(),
        robokassa_pass1_test: String(f.get("pass1t")).trim(),
        robokassa_pass2_test: String(f.get("pass2t")).trim(),
        robokassa_region: f.get("region") === "ru" ? "ru" : "kz",
        robokassa_receipt: f.get("receipt") === "on" ? "true" : "false",
        robokassa_sno: String(f.get("sno") ?? ""),
        robokassa_tax: String(f.get("tax") ?? "none"),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  // Адрес сайта известен только в браузере: читаем после отрисовки, иначе
  // сервер и браузер рисуют разный текст и React ругается на гидратацию (#418).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const resultUrl = `${origin}/api/robokassa/${shop.botId}/result`;
  const [region, setRegion] = useState<"kz" | "ru">(
    settings.robokassa_region === "ru" ? "ru" : "kz",
  );
  return (
    <Card title={t("settings.rk.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.rk.introResult")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">{resultUrl}</code>
        {t("settings.rk.introSuccess")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">
          {resultUrl.replace(/result$/, "success")}
        </code>
        {t("settings.rk.introFail")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">
          {resultUrl.replace(/result$/, "fail")}
        </code>
        {t("settings.rk.introTail")}
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <div className="flex gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.robokassa_enabled === "true"}
            />{" "}
            {t("settings.rk.enable")} <HelpTip article="settings-payment" anchor="robokassa" />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="test"
              defaultChecked={settings.robokassa_test_mode === "true"}
            />{" "}
            {t("settings.rk.test")} <HelpTip article="settings-payment" anchor="robokassa" />
          </label>
        </div>
        <Field label={t("settings.rk.region")}>
          <select
            className="input"
            name="region"
            value={region}
            onChange={(e) => setRegion(e.target.value === "ru" ? "ru" : "kz")}
          >
            <option value="kz">{t("settings.rk.regionKz")}</option>
            <option value="ru">{t("settings.rk.regionRu")}</option>
          </select>
        </Field>
        <p className="self-end text-xs text-muted">{t("settings.rk.regionHint")}</p>
        {region === "ru" && (
          <>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="receipt"
                defaultChecked={settings.robokassa_receipt === "true"}
              />
              {t("settings.rk.receipt")} <HelpTip article="settings-payment" anchor="robokassa" />
            </label>
            <Field label={t("settings.rk.sno")}>
              <select className="input" name="sno" defaultValue={settings.robokassa_sno ?? ""}>
                <option value="">{t("settings.rk.snoAccount")}</option>
                {RECEIPT_SNO.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("settings.rk.tax")}>
              <select className="input" name="tax" defaultValue={settings.robokassa_tax ?? "none"}>
                {RECEIPT_TAX.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-muted sm:col-span-2">{t("settings.rk.receiptHint")}</p>
          </>
        )}
        <Field label="MerchantLogin">
          <input
            className="input"
            name="login"
            defaultValue={settings.robokassa_login ?? ""}
            autoComplete="off"
          />
        </Field>
        <div />
        <Field label={t("settings.rk.pass1")}>
          <input
            className="input"
            name="pass1"
            type="password"
            defaultValue={settings.robokassa_pass1 ?? ""}
            autoComplete="off"
          />
        </Field>
        <Field label={t("settings.rk.pass2")}>
          <input
            className="input"
            name="pass2"
            type="password"
            defaultValue={settings.robokassa_pass2 ?? ""}
            autoComplete="off"
          />
        </Field>
        <Field label={t("settings.rk.pass1Test")}>
          <input
            className="input"
            name="pass1t"
            type="password"
            defaultValue={settings.robokassa_pass1_test ?? ""}
            autoComplete="off"
          />
        </Field>
        <Field label={t("settings.rk.pass2Test")}>
          <input
            className="input"
            name="pass2t"
            type="password"
            defaultValue={settings.robokassa_pass2_test ?? ""}
            autoComplete="off"
          />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
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

export function ReceiptOcrCard({
  settings,
  hasKey,
}: {
  settings: Record<string, string>;
  hasKey: boolean;
}) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const enabled = settings.receipt_ocr_auto !== "false";
  const deliver = settings.receipt_ocr_deliver === "on";
  const toggle = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { receipt_ocr_auto: v ? "true" : "false" } });
    await router.invalidate();
  });
  const toggleDeliver = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { receipt_ocr_deliver: v ? "on" : "off" } });
    await router.invalidate();
  });
  let usage = { count: 0, monthCount: 0, month: "" };
  try {
    usage = { ...usage, ...(JSON.parse(settings.receipt_ocr_usage || "{}") as object) };
  } catch {
    /* пустое значение */
  }
  const thisMonth = usage.month === new Date().toISOString().slice(0, 7) ? usage.monthCount : 0;
  return (
    <Card title={t("settings.ocr.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.ocr.intro")}</p>
      {!hasKey && (
        <p className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("settings.ocr.noKey")}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={toggle.busy || !hasKey}
          onChange={(v) => void toggle.run(v).catch(() => {})}
          label={t("settings.ocr.auto")}
        />
        <span className="text-sm">{enabled ? t("settings.ocr.on") : t("settings.ocr.off")}</span>
        <HelpTip article="settings-payment" anchor="receipt-ocr" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Switch
          checked={deliver}
          disabled={toggleDeliver.busy || !hasKey || !enabled}
          onChange={(v) => void toggleDeliver.run(v).catch(() => {})}
          label={t("settings.ocr.deliver")}
        />
        <span className="text-sm">
          {deliver ? t("settings.ocr.deliverOn") : t("settings.ocr.deliverOff")}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">{t("settings.ocr.month")}</dt>
        <dd className="tabular-nums">{thisMonth}</dd>
        <dt className="text-muted">{t("settings.ocr.total")}</dt>
        <dd className="tabular-nums">{usage.count}</dd>
      </dl>
      <ErrorBox error={toggle.error ?? toggleDeliver.error} />
    </Card>
  );
}

/** Оплата криптой через NOWPayments (core/payments/nowpayments): ключи — только владельцу. */
export function CryptoCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        crypto_enabled: f.get("enabled") === "on" ? "true" : "false",
        nowpayments_api_key: String(f.get("apiKey")).trim(),
        nowpayments_ipn_secret: String(f.get("ipnSecret")).trim(),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  // Адрес сайта известен только в браузере — как у Robokassa, после отрисовки.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Card title={t("settings.crypto.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.crypto.intro")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">{`${origin}/api/nowpayments/${shop.botId}`}</code>
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.crypto_enabled === "true"}
          />
          {t("settings.crypto.enabled")} <HelpTip article="settings-payment" anchor="crypto" />
        </label>
        <Field label={t("settings.crypto.apiKey")}>
          <input
            className="input"
            name="apiKey"
            autoComplete="off"
            defaultValue={settings.nowpayments_api_key ?? ""}
          />
        </Field>
        <Field label={t("settings.crypto.ipnSecret")}>
          <input
            className="input"
            name="ipnSecret"
            autoComplete="off"
            defaultValue={settings.nowpayments_ipn_secret ?? ""}
          />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

/** Оплата через Kaspi — ApiPay продавца (core/payments/kaspi-apipay): ключи — только владельцу. */
export function KaspiCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        kaspi_apipay_enabled: f.get("enabled") === "on" ? "true" : "false",
        kaspi_apipay_test_mode: f.get("testMode") === "on" ? "true" : "false",
        kaspi_apipay_api_key: String(f.get("apiKey")).trim(),
        kaspi_apipay_webhook_secret: String(f.get("webhookSecret")).trim(),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  // Адрес сайта известен только в браузере — как у Robokassa, после отрисовки.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Card title={t("settings.kaspi.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.kaspi.intro")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">{`${origin}/api/kaspi/${shop.botId}`}</code>
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.kaspi_apipay_enabled === "true"}
          />
          {t("settings.kaspi.enabled")} <HelpTip article="settings-payment" anchor="kaspi" />
        </label>
        <Field label={t("settings.kaspi.apiKey")}>
          <input
            className="input"
            name="apiKey"
            autoComplete="off"
            defaultValue={settings.kaspi_apipay_api_key ?? ""}
          />
        </Field>
        <Field label={t("settings.kaspi.webhookSecret")}>
          <input
            className="input"
            name="webhookSecret"
            autoComplete="off"
            defaultValue={settings.kaspi_apipay_webhook_secret ?? ""}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="testMode"
            defaultChecked={settings.kaspi_apipay_test_mode === "true"}
          />
          {t("settings.kaspi.testMode")} <HelpTip article="settings-payment" anchor="kaspi" />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

/** Оплата иностранной картой через Stripe (core/payments/stripe): ключи — только владельцу. */
export function StripeCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        stripe_enabled: f.get("enabled") === "on" ? "true" : "false",
        stripe_secret_key: String(f.get("secretKey")).trim(),
        stripe_webhook_secret: String(f.get("webhookSecret")).trim(),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Card title={t("settings.stripe.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.stripe.intro")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">{`${origin}/api/stripe/${shop.botId}`}</code>
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.stripe_enabled === "true"}
          />
          {t("settings.stripe.enabled")} <HelpTip article="settings-payment" anchor="stripe" />
        </label>
        <Field label={t("settings.stripe.secretKey")}>
          <input
            className="input"
            name="secretKey"
            autoComplete="off"
            defaultValue={settings.stripe_secret_key ?? ""}
          />
        </Field>
        <Field label={t("settings.stripe.webhookSecret")}>
          <input
            className="input"
            name="webhookSecret"
            autoComplete="off"
            defaultValue={settings.stripe_webhook_secret ?? ""}
          />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

/** Карта РФ и СБП через Продамус (core/payments/prodamus): ключ — только владельцу. */
export function ProdamusCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        prodamus_enabled: f.get("enabled") === "on" ? "true" : "false",
        prodamus_form_url: String(f.get("formUrl")).trim(),
        prodamus_secret_key: String(f.get("secretKey")).trim(),
        prodamus_currency: String(f.get("currency")),
        prodamus_rate: String(f.get("rate")).trim().replace(",", "."),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Card title={t("settings.prodamus.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.prodamus.intro")}{" "}
        <code className="break-all rounded bg-surface-2 px-1">{`${origin}/api/prodamus/${shop.botId}`}</code>
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.prodamus_enabled === "true"}
          />
          {t("settings.prodamus.enabled")} <HelpTip article="settings-payment" anchor="prodamus" />
        </label>
        <Field label={t("settings.prodamus.formUrl")}>
          <input
            className="input"
            name="formUrl"
            autoComplete="off"
            placeholder="https://shop.payform.ru"
            defaultValue={settings.prodamus_form_url ?? ""}
          />
        </Field>
        <Field label={t("settings.prodamus.secretKey")}>
          <input
            className="input"
            name="secretKey"
            autoComplete="off"
            defaultValue={settings.prodamus_secret_key ?? ""}
          />
        </Field>
        <Field
          label={t("settings.prodamus.currency")}
          help={<HelpTip article="settings-payment" anchor="prodamus" />}
        >
          <select
            className="input"
            name="currency"
            defaultValue={(settings.prodamus_currency ?? "RUB").toUpperCase()}
          >
            {["RUB", "KZT", "USD", "EUR"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("settings.prodamus.rate")}
          help={<HelpTip article="settings-payment" anchor="prodamus" />}
        >
          <input
            className="input"
            name="rate"
            inputMode="decimal"
            autoComplete="off"
            placeholder="5.8"
            defaultValue={settings.prodamus_rate ?? ""}
          />
        </Field>
        <p className="text-xs text-muted sm:col-span-2">{t("settings.prodamus.currencyHint")}</p>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
