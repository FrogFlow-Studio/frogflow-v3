import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  connectTelegramAdminFn,
  syncZernioAccountsFn,
  zernioConnectLinkFn,
  zernioStateFn,
  deleteDeliveryZoneFn,
  deletePaymentMethodFn,
  saveDeliveryZoneFn,
  deliveryZonesFn,
  savePaymentMethodFn,
  saveSettingsFn,
  settingsFn,
  setShopTimezoneFn,
  setPdfWatermarkFn,
  telegramStateFn,
  deleteTeamMemberFn,
  saveTeamMemberFn,
  teamFn,
} from "@/app/admin/admin.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { directBotSettingsFn, saveDirectBotSettingsFn } from "@/app/admin/channels.functions";
import { notifyPrefsFn, saveNotifyPrefsFn } from "@/app/admin/notify.functions";
import { crmFn, saveCrmFn, testCrmFn } from "@/app/admin/crm.functions";
import { NOTIFY_KINDS, type NotifyPrefs } from "@/core/notify/prefs";
import type { DirectBotSettings } from "@/core/instagram/direct-bot-settings";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
import { imagePath } from "@/core/catalog/image-url";

export const Route = createFileRoute("/admin/_authed/settings")({
  loader: async () => {
    const [settings, telegram, zones, zernio] = await Promise.all([
      settingsFn(),
      telegramStateFn(),
      deliveryZonesFn(),
      zernioStateFn(),
    ]);
    return { ...settings, telegram, zones, zernio };
  },
  component: SettingsPage,
});

type Method = Awaited<ReturnType<typeof settingsFn>>["methods"][number];

const CURRENCIES = ["KZT", "RUB", "USD", "EUR", "UZS", "KGS", "BYN", "UAH", "TRY", "AED"];
const TIMEZONES = [
  "Asia/Almaty",
  "Asia/Aqtobe",
  "Asia/Aqtau",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Novosibirsk",
  "Asia/Tashkent",
  "Asia/Bishkek",
  "Europe/Minsk",
  "Europe/Kyiv",
  "Asia/Dubai",
  "Europe/Istanbul",
  "Asia/Baku",
  "Asia/Tbilisi",
  "Asia/Yerevan",
];

function SettingsPage() {
  const {
    settings,
    methods,
    ownerTelegramId,
    timezone,
    telegram,
    zones,
    zernio,
    smartSearchKey,
    visionKey,
    pdfWatermark,
  } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await setShopTimezoneFn({ data: { timezone: String(f.get("shop_timezone") ?? "") } });
    await saveSettingsFn({
      data: {
        shop_name: String(f.get("shop_name")),
        shop_currency: String(f.get("shop_currency") || "KZT").toUpperCase(),
        shop_tagline: String(f.get("shop_tagline") ?? ""),
        storefront_accent: String(f.get("storefront_accent_on") ? f.get("storefront_accent") : ""),
        admin_chat_id: String(f.get("admin_chat_id")),
        admin_contact_link: String(f.get("admin_contact_link")),
        instruction_caption: String(f.get("instruction_caption")),
        ...(shop.modules.loyalty
          ? { loyalty_earn_percent: String(f.get("loyalty_earn_percent") || "5") }
          : {}),
        ...(shop.modules.multi_language
          ? { delivery_lang_timing: String(f.get("delivery_lang_timing") || "during") }
          : {}),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <>
      <PageTitle title={t("settings.title")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TelegramCard telegram={telegram} />
        {(shop.modules.instagram || shop.modules.whatsapp) && (
          <ChannelsCard
            zernio={zernio}
            instagram={shop.modules.instagram}
            whatsapp={shop.modules.whatsapp}
          />
        )}
        {shop.modules.instagram && <DirectBotCard platform="instagram" />}
        {shop.modules.whatsapp && <DirectBotCard platform="whatsapp" />}
        <Card title={t("settings.shop.title")}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <Field label={t("settings.shop.name")}>
              <input
                className="input"
                name="shop_name"
                defaultValue={settings.shop_name ?? shop.name}
              />
            </Field>
            <Field
              label={t("settings.shop.adminChatId")}
              hint={t("settings.shop.adminChatIdHint", {
                owner: ownerTelegramId ? ` (${ownerTelegramId})` : "",
              })}
            >
              <input
                className="input"
                name="admin_chat_id"
                defaultValue={settings.admin_chat_id ?? ""}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("settings.shop.currency")} hint={t("settings.shop.currencyHint")}>
                <select
                  className="input"
                  name="shop_currency"
                  defaultValue={(settings.shop_currency ?? "KZT").toUpperCase()}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("settings.shop.timezone")} hint={t("settings.shop.timezoneHint")}>
                <select className="input" name="shop_timezone" defaultValue={timezone ?? ""}>
                  <option value="">{t("settings.shop.timezoneDefault")}</option>
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t("settings.shop.tagline")} hint={t("settings.shop.taglineHint")}>
              <input
                className="input"
                name="shop_tagline"
                maxLength={160}
                defaultValue={settings.shop_tagline ?? ""}
              />
            </Field>
            <Field label={t("settings.shop.accent")} hint={t("settings.shop.accentHint")}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="storefront_accent_on"
                  defaultChecked={Boolean(settings.storefront_accent)}
                />
                <input
                  type="color"
                  name="storefront_accent"
                  className="h-9 w-16 rounded border border-line"
                  defaultValue={settings.storefront_accent || "#2f9e5f"}
                />
              </div>
            </Field>
            <Field label={t("settings.shop.contactLink")}>
              <input
                className="input"
                name="admin_contact_link"
                defaultValue={settings.admin_contact_link ?? ""}
                placeholder="https://t.me/username"
              />
            </Field>
            {shop.modules.loyalty && (
              <Field
                label={t("settings.shop.loyaltyPercent")}
                hint={t("settings.shop.loyaltyHint")}
              >
                <input
                  className="input w-32"
                  name="loyalty_earn_percent"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={settings.loyalty_earn_percent ?? "5"}
                />
              </Field>
            )}
            {shop.modules.multi_language && (
              <Field label={t("settings.shop.langTiming")} hint={t("settings.shop.langTimingHint")}>
                <select
                  className="input"
                  name="delivery_lang_timing"
                  defaultValue={settings.delivery_lang_timing ?? "during"}
                >
                  <option value="during">{t("settings.shop.langDuring")}</option>
                  <option value="before">{t("settings.shop.langBefore")}</option>
                </select>
              </Field>
            )}
            <Field label={t("settings.shop.instruction")}>
              <textarea
                className="input"
                name="instruction_caption"
                rows={3}
                defaultValue={settings.instruction_caption ?? ""}
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
        <PaymentMethods methods={methods} />
        <FulfillmentCard settings={settings} />
        <ZonesCard zones={zones} />
        <WatermarkCard enabled={pdfWatermark} />
        {shop.modules.robokassa && <RobokassaCard settings={settings} />}
        {shop.modules.telegram_stars && <StarsCard settings={settings} />}
        {shop.modules.receipt_ocr && <ReceiptOcrCard settings={settings} hasKey={visionKey} />}
        {shop.modules.smart_search && (
          <SmartSearchCard settings={settings} hasKey={smartSearchKey} />
        )}
        {shop.modules.legal_docs && <LegalCard settings={settings} />}
        {shop.modules.notify_in_bot && <NotifyCard />}
        {shop.modules.crm_integration && <CrmCard />}
        {shop.modules.admin_roles && <TeamCard />}
      </div>
    </>
  );
}

function PaymentMethods({ methods }: { methods: Method[] }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
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
              {t("settings.pay.active")}
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

type TelegramState = Awaited<ReturnType<typeof telegramStateFn>>;

function TelegramCard({ telegram }: { telegram: TelegramState }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [result, setResult] = useState<string | null>(null);
  const connect = useAction(async (token: string) => {
    const r = await connectTelegramAdminFn({ data: { token } });
    setResult(
      r.webhook?.ok
        ? t("settings.tg.connected", { username: r.username ?? "" })
        : t("settings.tg.webhookFailed", {
            error: r.webhook?.error ?? t("settings.tg.unknown"),
          }),
    );
    await router.invalidate();
  });
  const ok = telegram.connected && telegram.servedBy === "v2" && telegram.webhook?.ok;
  return (
    <Card
      title={t("settings.tg.title")}
      actions={
        telegram.connected ? (
          <Badge tone={ok ? "ok" : "warn"}>
            {ok
              ? t("settings.tg.working", { username: telegram.username ?? "" })
              : t("settings.tg.checkWebhook", {
                  username: telegram.username ?? t("settings.tg.botFallback"),
                })}
          </Badge>
        ) : (
          <Badge>{t("settings.tg.notConnected")}</Badge>
        )
      }
      className="lg:col-span-2"
    >
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          {t("settings.tg.step1Before")}{" "}
          <a
            className="text-accent hover:underline"
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
          >
            @BotFather
          </a>
          {t("settings.tg.step1Middle")} <code>/newbot</code>
          {t("settings.tg.step1After")}
        </li>
        <li>
          {t("settings.tg.step2Before")} <code>123456789:AA…</code> {t("settings.tg.step2After")}
        </li>
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
            telegram.connected ? t("settings.tg.tokenNew") : t("settings.tg.tokenPlaceholder")
          }
          autoComplete="off"
          required
        />
        <button className="btn-primary shrink-0" disabled={connect.busy}>
          {telegram.connected ? t("settings.tg.replace") : t("settings.tg.connect")}
        </button>
      </form>
      {result && <p className="mt-2 text-sm text-muted">{result}</p>}
      <ErrorBox error={connect.error} />
      {telegram.connected && telegram.webhook && !telegram.webhook.ok && (
        <p className="mt-2 text-xs text-warn">
          {t("settings.tg.webhookNow", {
            url: telegram.webhook.url ?? t("settings.tg.webhookNone"),
          })}{" "}
          {telegram.servedBy !== "v2" ? t("settings.tg.legacy") : t("settings.tg.reinstall")}
        </p>
      )}
    </Card>
  );
}

type ZernioState = Awaited<ReturnType<typeof zernioStateFn>>;

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

function ChannelsCard({
  zernio,
  instagram,
  whatsapp,
}: {
  zernio: ZernioState;
  instagram: boolean;
  whatsapp: boolean;
}) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [note, setNote] = useState<string | null>(null);
  const connect = useAction(async (platform: "instagram" | "whatsapp") => {
    const r = await zernioConnectLinkFn({ data: { platform } });
    window.location.assign(r.url);
  });
  const sync = useAction(async () => {
    const r = await syncZernioAccountsFn();
    setNote(
      r.accounts.length
        ? t("settings.ch.syncedCount", { n: r.accounts.length })
        : t("settings.ch.syncedNone"),
    );
    await router.invalidate();
  });
  // Возврат из авторизации Zernio: подтянуть аккаунты и убрать метку из адреса.
  useEffect(() => {
    if (!window.location.search.includes("zernio=connected")) return;
    window.history.replaceState(null, "", window.location.pathname);
    void sync.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live = zernio.accounts.filter((a) => !a.expired).length;
  return (
    <Card
      title={t("settings.ch.title")}
      actions={
        live > 0 ? (
          <Badge tone="ok">
            {live === 1
              ? t("settings.ch.liveOne", { n: live })
              : t("settings.ch.liveMany", { n: live })}
          </Badge>
        ) : (
          <Badge>{t("settings.ch.notConnected")}</Badge>
        )
      }
      className="lg:col-span-2"
    >
      <p className="mb-3 text-sm text-muted">{t("settings.ch.intro")}</p>
      {!zernio.configured && (
        <p className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("settings.ch.notConfigured")}
        </p>
      )}
      {(zernio.accounts.length > 0 || zernio.manualIds.length > 0) && (
        <ul className="mb-3 divide-y divide-line rounded-md border border-line text-sm">
          {zernio.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">{CHANNEL_LABEL[a.platform] ?? a.platform}</span>{" "}
                <span className="text-muted">
                  {a.username ? `@${a.username}` : (a.name ?? a.id)}
                </span>
              </span>
              <Badge tone={a.expired ? "warn" : "ok"}>
                {a.expired ? t("settings.ch.expired") : t("settings.ch.working")}
              </Badge>
            </li>
          ))}
          {zernio.manualIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-muted">{t("settings.ch.account", { id })}</span>
              <Badge>{t("settings.ch.byOperator")}</Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {instagram && (
          <button
            type="button"
            className="btn-primary"
            disabled={connect.busy || !zernio.configured}
            onClick={() => void connect.run("instagram").catch(() => {})}
          >
            {t("settings.ch.connectInstagram")}
          </button>
        )}
        {whatsapp && (
          <button
            type="button"
            className="btn-primary"
            disabled={connect.busy || !zernio.configured}
            onClick={() => void connect.run("whatsapp").catch(() => {})}
          >
            {t("settings.ch.connectWhatsapp")}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={sync.busy || !zernio.configured}
          onClick={() => void sync.run().catch(() => {})}
        >
          {t("settings.ch.refresh")}
        </button>
      </div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {zernio.syncedAt && (
        <p className="mt-2 text-xs text-muted">
          {t("settings.ch.updatedAt", {
            date: new Date(zernio.syncedAt).toLocaleString(intlLocale(shop.locale)),
          })}
        </p>
      )}
      <ErrorBox error={connect.error ?? sync.error} />
    </Card>
  );
}

/**
 * Автоответчик канала: тумблер, область ответов, слова-вызовы, ответ на
 * непонятное, что из магазина включено. Ключи те же, что в v1.
 */
function DirectBotCard({ platform }: { platform: "instagram" | "whatsapp" }) {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [s, setS] = useState<(DirectBotSettings & { triggersText: string }) | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void directBotSettingsFn({ data: { platform } }).then((r) =>
      setS({ ...r, triggersText: r.triggers.join(", ") }),
    );
  }, [platform]);
  const save = useAction(async () => {
    if (!s) return;
    await saveDirectBotSettingsFn({
      data: {
        platform,
        enabled: s.enabled,
        scope: s.scope,
        triggers: s.triggersText,
        script: s.script,
        features: s.features,
        ignoreExcluded: s.ignoreExcluded,
        notifyTemplate: s.notifyTemplate,
      },
    });
    setSaved(true);
  });
  const owner = shop.role === "owner";
  const feature = (k: keyof DirectBotSettings["features"], label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={s?.features[k] ?? true}
        disabled={!owner}
        onChange={(e) => s && setS({ ...s, features: { ...s.features, [k]: e.target.checked } })}
      />
      {label}
    </label>
  );
  return (
    <Card
      title={t("settings.dbot.title", { channel: CHANNEL_LABEL[platform] ?? platform })}
      actions={
        s && (
          <Switch
            checked={s.enabled}
            onChange={(on) => owner && setS({ ...s, enabled: on })}
            label={t("settings.dbot.enabled")}
          />
        )
      }
    >
      {!s ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          <p className="text-sm text-muted">{t("settings.dbot.intro")}</p>
          <Field label={t("settings.dbot.scope")}>
            <div className="space-y-1 text-sm">
              {(["purchases", "all"] as const).map((v) => (
                <label key={v} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`scope-${platform}`}
                    checked={s.scope === v}
                    disabled={!owner}
                    onChange={() => setS({ ...s, scope: v })}
                  />
                  <span>
                    {t(`settings.dbot.scope.${v}`)}
                    <span className="block text-xs text-muted">
                      {t(`settings.dbot.scope.${v}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label={t("settings.dbot.triggers")} hint={t("settings.dbot.triggersHint")}>
            <input
              className="input"
              value={s.triggersText}
              disabled={!owner}
              placeholder={t("settings.dbot.triggersPlaceholder")}
              onChange={(e) => setS({ ...s, triggersText: e.target.value })}
            />
          </Field>
          <Field label={t("settings.dbot.script")} hint={t("settings.dbot.scriptHint")}>
            <textarea
              className="input min-h-20"
              value={s.script}
              disabled={!owner}
              placeholder={t("settings.dbot.scriptPlaceholder")}
              onChange={(e) => setS({ ...s, script: e.target.value })}
            />
          </Field>
          <Field label={t("settings.dbot.features")}>
            <div className="grid grid-cols-2 gap-1">
              {feature("catalog", t("settings.dbot.feature.catalog"))}
              {feature("search", t("settings.dbot.feature.search"))}
              {feature("cart", t("settings.dbot.feature.cart"))}
              {feature("checkout", t("settings.dbot.feature.checkout"))}
            </div>
          </Field>
          {platform === "whatsapp" && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.ignoreExcluded}
                  disabled={!owner}
                  onChange={(e) => setS({ ...s, ignoreExcluded: e.target.checked })}
                />
                {t("settings.dbot.ignoreExcluded")}
              </label>
              <Field
                label={t("settings.dbot.notifyTemplate")}
                hint={t("settings.dbot.notifyTemplateHint")}
              >
                <input
                  className="input"
                  value={s.notifyTemplate}
                  disabled={!owner}
                  placeholder="order_update:ru"
                  onChange={(e) => setS({ ...s, notifyTemplate: e.target.value })}
                />
              </Field>
              <p className="text-xs text-muted">{t("settings.dbot.nativeCatalogHint")}</p>
            </>
          )}
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
      )}
    </Card>
  );
}

function FulfillmentCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        fulfillment_pickup_enabled: f.get("pickup") === "on" ? "true" : "false",
        fulfillment_delivery_enabled: f.get("delivery") === "on" ? "true" : "false",
        payment_mode: String(f.get("payment_mode")),
        deposit_percent: String(f.get("deposit_percent") || "30"),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const [mode, setMode] = useState(settings.payment_mode ?? "full");
  return (
    <Card title={t("settings.ful.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="pickup"
              defaultChecked={settings.fulfillment_pickup_enabled !== "false"}
            />{" "}
            {t("settings.ful.pickup")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="delivery"
              defaultChecked={settings.fulfillment_delivery_enabled !== "false"}
            />{" "}
            {t("settings.ful.delivery")}
          </label>
        </div>
        <Field label={t("settings.ful.paymentMode")}>
          <select
            className="input"
            name="payment_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="full">{t("settings.ful.full")}</option>
            <option value="deposit">{t("settings.ful.deposit")}</option>
            <option value="on_receipt">{t("settings.ful.onReceipt")}</option>
          </select>
        </Field>
        {mode === "deposit" && (
          <Field label={t("settings.ful.depositPercent")}>
            <input
              className="input w-32"
              name="deposit_percent"
              type="number"
              min={1}
              max={100}
              defaultValue={settings.deposit_percent ?? "30"}
            />
          </Field>
        )}
        <div className="flex items-center gap-3">
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

type Zone = Awaited<ReturnType<typeof deliveryZonesFn>>[number];

function ZonesCard({ zones }: { zones: Zone[] }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [editing, setEditing] = useState<Zone | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    await saveDeliveryZoneFn({
      data: {
        id,
        name: String(f.get("name")),
        price: Number(f.get("price")) || 0,
        isActive: f.get("isActive") === "on",
        sortOrder: Number(f.get("sortOrder")) || 0,
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("settings.zones.deleteConfirm"))) return;
    await deleteDeliveryZoneFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  return (
    <Card
      title={t("settings.zones.title")}
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          {t("settings.zones.add")}
        </button>
      }
    >
      <p className="mb-3 text-xs text-muted">{t("settings.zones.intro")}</p>
      {zones.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.zones.empty")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {z.name} <span className="text-muted">· {Number(z.price)}</span>{" "}
                {!z.is_active && <Badge>{t("settings.off")}</Badge>}
              </span>
              <span className="shrink-0">
                <button className="btn-ghost text-xs" onClick={() => setEditing(z)}>
                  {t("common.edit")}
                </button>
                <button
                  className="btn-ghost text-xs text-danger"
                  onClick={() => void del.run(z.id).catch(() => {})}
                >
                  {t("common.delete")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={del.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_120px_80px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <Field label={t("settings.name")}>
            <input
              className="input"
              name="name"
              defaultValue={cur?.name ?? ""}
              required
              maxLength={80}
              placeholder={t("settings.zones.namePlaceholder")}
            />
          </Field>
          <Field label={t("settings.zones.price")}>
            <input
              className="input"
              name="price"
              type="number"
              min={0}
              step="1"
              defaultValue={cur ? Number(cur.price) : 0}
            />
          </Field>
          <Field label={t("settings.order")}>
            <input
              className="input"
              name="sortOrder"
              type="number"
              defaultValue={cur?.sort_order ?? zones.length}
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
            {t("settings.zones.active")}
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
          <ErrorBox error={save.error} />
        </form>
      )}
    </Card>
  );
}

function LegalCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
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
            <textarea className="input" name={k} rows={5} defaultValue={settings[k] ?? ""} />
          </Field>
        ))}
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

/** Telegram Stars: курс «1 ⭐ = X в валюте магазина»; без курса кнопка оплаты не показывается. */
function StarsCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
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
        <Field label={t("settings.stars.rate", { currency })} hint={t("settings.stars.rateHint")}>
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

function RobokassaCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
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
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const resultUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/robokassa/${shop.botId}/result`;
  return (
    <Card title={t("settings.rk.title")} className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        {t("settings.rk.introResult")}{" "}
        <code className="rounded bg-surface-2 px-1">{resultUrl}</code>
        {t("settings.rk.introSuccess")}{" "}
        <code className="rounded bg-surface-2 px-1">{resultUrl.replace(/result$/, "success")}</code>
        {t("settings.rk.introFail")}{" "}
        <code className="rounded bg-surface-2 px-1">{resultUrl.replace(/result$/, "fail")}</code>
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
            {t("settings.rk.enable")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="test"
              defaultChecked={settings.robokassa_test_mode === "true"}
            />{" "}
            {t("settings.rk.test")}
          </label>
        </div>
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

function SmartSearchCard({
  settings,
  hasKey,
}: {
  settings: Record<string, string>;
  hasKey: boolean;
}) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
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
function WatermarkCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
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

function ReceiptOcrCard({
  settings,
  hasKey,
}: {
  settings: Record<string, string>;
  hasKey: boolean;
}) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const enabled = settings.receipt_ocr_auto !== "false";
  const toggle = useAction(async (v: boolean) => {
    await saveSettingsFn({ data: { receipt_ocr_auto: v ? "true" : "false" } });
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
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">{t("settings.ocr.month")}</dt>
        <dd className="tabular-nums">{thisMonth}</dd>
        <dt className="text-muted">{t("settings.ocr.total")}</dt>
        <dd className="tabular-nums">{usage.count}</dd>
      </dl>
      <ErrorBox error={toggle.error} />
    </Card>
  );
}

type Member = Awaited<ReturnType<typeof teamFn>>[number];

/**
 * Команда магазина: владелец заводит менеджеров (заказы, товары, рассылки) и
 * пользователей «только просмотр» (бухгалтер, аналитик). Логин уникален на
 * платформе, пароль от 8 символов; все действия подписываются логином в
 * истории заказа.
 */
/**
 * Уведомления продавцу: что и куда приходит, тихие часы, утренний дайджест.
 * Владелец меняет, остальные видят.
 */
function NotifyCard() {
  const { shop } = Route.useRouteContext();
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
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    if (!p) return;
    await saveNotifyPrefsFn({
      data: {
        kinds: p.kinds,
        email: p.email,
        quiet: quietOn ? (p.quiet ?? { from: "22:00", to: "08:00" }) : null,
        digest: p.digest,
      },
    });
    setSaved(true);
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
              <th>{t("settings.notify.col.event")}</th>
              <th className="text-center">Telegram</th>
              <th className="text-center">{t("settings.notify.col.email")}</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFY_KINDS.map((k) => (
              <tr key={k}>
                <td>
                  {t(`settings.notify.kind.${k}`)}
                  {["new_order", "delivery_failure", "complaint"].includes(k) && (
                    <span className="ml-2 text-xs text-muted">{t("settings.notify.urgent")}</span>
                  )}
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={p.kinds[k].telegram}
                    disabled={!owner}
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
            ))}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("settings.notify.email")}
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
        <Field label={t("settings.notify.digest")} hint={t("settings.notify.digestHint")}>
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
    </Card>
  );
}

/** Интеграция с CRM и Таблицами: события заказа POST-запросом на адрес продавца. */
function CrmCard() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [d, setD] = useState<Awaited<ReturnType<typeof crmFn>> | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void crmFn().then((r) => {
      setD(r);
      setUrl(r.url);
      setEvents(r.events);
    });
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    await saveCrmFn({ data: { url, secret: secret ? secret : null, events } });
    setSecret("");
    setNote(t("settings.saved"));
  });
  const test = useAction(async () => {
    const r = await testCrmFn();
    setNote(r.ok ? t("settings.crm.testOk") : t("settings.crm.testFail", { error: r.error }));
  });
  if (!d) return null;
  return (
    <Card title={t("settings.crm.title")} className="lg:col-span-2">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setNote(null);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.crm.intro")}</p>
        <Field label={t("settings.crm.url")} hint={t("settings.crm.urlHint")}>
          <input
            className="input"
            value={url}
            disabled={!owner}
            placeholder="https://script.google.com/macros/s/…/exec"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field
          label={t("settings.crm.secret")}
          hint={d.hasSecret ? t("settings.crm.secretSet") : t("settings.crm.secretHint")}
        >
          <input
            className="input"
            type="password"
            value={secret}
            disabled={!owner}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        <Field label={t("settings.crm.events")}>
          <div className="grid gap-1 sm:grid-cols-3">
            {d.all.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!owner}
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents((x) => (e.target.checked ? [...x, ev] : x.filter((y) => y !== ev)))
                  }
                />
                {t(`settings.crm.event.${ev}` as never)}
              </label>
            ))}
          </div>
        </Field>
        {owner && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={test.busy || !d.url}
              onClick={() => {
                setNote(null);
                void test.run().catch(() => {});
              }}
            >
              {t("settings.crm.test")}
            </button>
            {note && <span className="text-sm text-muted">{note}</span>}
          </div>
        )}
        <ErrorBox error={save.error ?? test.error} />
      </form>
    </Card>
  );
}

function TeamCard() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = () =>
    teamFn()
      .then(setMembers)
      .catch((e) => setError(e));
  useEffect(() => {
    void reload();
  }, []);
  const save = useAction(async (f: FormData) => {
    await saveTeamMemberFn({
      data: {
        username: String(f.get("username")),
        name: String(f.get("name") || ""),
        role: f.get("role") === "viewer" ? "viewer" : "manager",
        password: String(f.get("password") || "") || undefined,
      },
    });
    setEditing(null);
    await reload();
  });
  const remove = useAction(async (username: string) => {
    if (!confirm(t("settings.team.deleteConfirm", { username }))) return;
    await deleteTeamMemberFn({ data: { username } });
    await reload();
  });
  const current = editing === "new" ? null : editing;
  return (
    <Card
      title={t("settings.team.title")}
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          {t("settings.team.add")}
        </button>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("settings.team.intro")}</p>
      <ErrorBox error={error ?? remove.error} />
      {members === null ? (
        <p className="text-sm text-muted">{t("settings.team.loading")}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.team.onlyYou")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {members.map((m) => (
            <li key={m.username} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <span className="font-medium">{m.username}</span>
                {m.name && <span className="text-muted"> · {m.name}</span>}{" "}
                <Badge tone={m.role === "manager" ? "accent" : "neutral"}>
                  {t(`role.${m.role}`)}
                </Badge>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn-ghost text-xs" onClick={() => setEditing(m)}>
                  {t("common.edit")}
                </button>
                <button
                  className="btn-ghost text-xs text-danger"
                  disabled={remove.busy}
                  onClick={() => void remove.run(m.username).catch(() => {})}
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <form
          key={current?.username ?? "new"}
          className="mt-4 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <Field label={t("settings.team.username")} hint={t("settings.team.usernameHint")}>
            <input
              className="input"
              name="username"
              defaultValue={current?.username ?? ""}
              readOnly={Boolean(current)}
              required
              autoComplete="off"
            />
          </Field>
          <Field label={t("settings.team.name")}>
            <input
              className="input"
              name="name"
              defaultValue={current?.name ?? ""}
              maxLength={80}
            />
          </Field>
          <Field label={t("settings.team.role")}>
            <select className="input" name="role" defaultValue={current?.role ?? "manager"}>
              <option value="manager">{t("settings.team.roleManager")}</option>
              <option value="viewer">{t("settings.team.roleViewer")}</option>
            </select>
          </Field>
          <Field
            label={current ? t("settings.team.newPassword") : t("settings.team.password")}
            hint={t("settings.team.passwordHint")}
          >
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required={!current}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
          <div className="sm:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        </form>
      )}
    </Card>
  );
}
