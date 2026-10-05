import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  zernioStateFn,
  deliveryZonesFn,
  saveSettingsFn,
  settingsFn,
  setShopTimezoneFn,
  telegramStateFn,
} from "@/app/admin/admin.functions";
import { Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import {
  entryMatches,
  entryVisible,
  recentEntries,
  SETTINGS_REGISTRY,
  SETTINGS_THEMES,
  type SettingsTheme,
} from "@/app/admin/settings/registry";
import {
  SettingsFilterProvider,
  SettingsSection,
  type SettingsFilter,
} from "@/app/admin/settings/section";
import { lazyCard } from "@/app/admin/settings/lazy-card";
import type { Locale } from "@/core/i18n/locale";
import { DELIVERY_NOTE_MAX } from "@/core/delivery/note";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { parseWebCheckout } from "@/core/storefront/web-checkout-settings";
import { ChannelsCard, DirectBotCard, TelegramCard } from "@/app/admin/settings/channels";
import { PushCard } from "@/app/admin/settings/push";
import { FulfillmentCard, ZonesCard } from "@/app/admin/settings/delivery";
import { AboutCard } from "@/app/admin/settings/about";
import { DesignCard } from "@/app/admin/settings/design";
import { MarketplaceCard } from "@/app/admin/settings/marketplace";
import { MinOrderCard } from "@/app/admin/settings/min-order";
import { CommunityCard } from "@/app/admin/settings/community";
import { FreeDeliveryCard } from "@/app/admin/settings/free-delivery";
import { LowStockCard, NotifyCard } from "@/app/admin/settings/notify";
import {
  PaymentMethods,
  ReceiptOcrCard,
  RobokassaCard,
  CryptoCard,
  StripeCard,
  StarsCard,
} from "@/app/admin/settings/payments";
import {
  LegalCard,
  PayReminderCard,
  SmartSearchCard,
  WatermarkCard,
  WeeklyReportCard,
  AutoMessagesCard,
  ServiceNoticesCard,
} from "@/app/admin/settings/shop";

// Карточки за модулем или ролью: код приходит, только когда карточку показывают.
const DeleteShopCard = lazyCard<{ locale: Locale; shopName: string }>(
  () => import("@/app/admin/deletion-ui"),
  "DeleteShopCard",
);
const ChannelWizardCards = lazyCard<{ instagram: boolean; whatsapp: boolean }>(
  () => import("@/app/admin/settings/channel-wizard"),
  "ChannelWizardCards",
);
const IceBreakersCard = lazyCard<object>(
  () => import("@/app/admin/settings/ice-breakers"),
  "IceBreakersCard",
);
const CrmCard = lazyCard<object>(() => import("@/app/admin/settings/crm"), "CrmCard");
const ApiKeyCard = lazyCard<object>(() => import("@/app/admin/settings/api-key"), "ApiKeyCard");
const GiftWrapCard = lazyCard<object>(
  () => import("@/app/admin/settings/gift-wrap"),
  "GiftWrapCard",
);
const TeamCard = lazyCard<object>(() => import("@/app/admin/settings/team"), "TeamCard");
const TakeoutCard = lazyCard<object>(() => import("@/app/admin/settings/takeout"), "TakeoutCard");
const InviteCard = lazyCard<object>(() => import("@/app/admin/settings/invite"), "InviteCard");

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
    recentKeys,
  } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState<SettingsTheme | "all">("all");
  const [query, setQuery] = useState("");
  const text = (k: AdminKey, vars?: Record<string, string>) => t(k, vars);
  const visibleEntries = SETTINGS_REGISTRY.filter(
    (e) =>
      entryVisible(e, shop) &&
      (theme === "all" || e.theme === theme) &&
      entryMatches(e, query, text),
  );
  const filter: SettingsFilter = {
    shown: new Set(visibleEntries.map((e) => e.id)),
    recent: recentEntries(recentKeys),
  };
  // Разделы с отдельной страницы — ссылкой, но только когда человек ищет или выбрал тему.
  const links = query.trim() || theme !== "all" ? visibleEntries.filter((e) => e.to) : [];
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await setShopTimezoneFn({ data: { timezone: String(f.get("shop_timezone") ?? "") } });
    await saveSettingsFn({
      data: {
        shop_name: String(f.get("shop_name")),
        shop_currency: String(f.get("shop_currency") || "KZT").toUpperCase(),
        shop_tagline: String(f.get("shop_tagline") ?? ""),
        storefront_accent: String(f.get("storefront_accent_on") ? f.get("storefront_accent") : ""),
        ...(shop.modules.web_storefront
          ? {
              storefront_checkout: JSON.stringify({
                enabled: Boolean(f.get("storefront_checkout")),
                tgLogin: Boolean(f.get("storefront_tg_login")),
              }),
            }
          : {}),
        admin_chat_id: String(f.get("admin_chat_id")),
        admin_contact_link: String(f.get("admin_contact_link")),
        instruction_caption: String(f.get("instruction_caption")),
        ...(shop.modules.instagram || shop.modules.whatsapp
          ? { delivery_email_note: String(f.get("delivery_email_note") ?? "") }
          : {}),
        ...(shop.modules.loyalty
          ? {
              loyalty_earn_percent: String(f.get("loyalty_earn_percent") || "5"),
              loyalty_max_redeem_percent: String(f.get("loyalty_max_redeem_percent") || "100"),
            }
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
      <div className="mb-4 space-y-2">
        <input
          type="search"
          className="input"
          value={query}
          placeholder={t("settings19.search")}
          aria-label={t("settings19.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {(["all", ...SETTINGS_THEMES] as const).map((x) => (
            <button
              key={x}
              type="button"
              className={`btn-ghost text-sm ${theme === x ? "font-medium text-accent" : ""}`}
              aria-pressed={theme === x}
              onClick={() => setTheme(x)}
            >
              {t(`settings19.theme.${x}` as AdminKey)}
            </button>
          ))}
        </div>
      </div>
      {visibleEntries.length === 0 && <Empty>{t("settings19.empty")}</Empty>}
      {links.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {links.map((e) => (
            <div key={e.id} className="card flex items-center justify-between gap-3 p-3">
              <span>
                <span className="block font-medium">{t(e.title, e.titleVars)}</span>
                <span className="block text-xs text-muted">{t("settings19.elsewhere")}</span>
              </span>
              <a href={e.to} className="btn-secondary text-sm">
                {t("settings19.open")}
              </a>
            </div>
          ))}
        </div>
      )}
      <SettingsFilterProvider value={filter}>
        <div className="grid gap-4 lg:grid-cols-2">
          <SettingsSection id="telegram">
            <TelegramCard telegram={telegram} />
          </SettingsSection>
          {(shop.modules.instagram || shop.modules.whatsapp) && (
            <SettingsSection id="channel-wizard">
              <ChannelWizardCards
                instagram={shop.modules.instagram}
                whatsapp={shop.modules.whatsapp}
              />
            </SettingsSection>
          )}
          {(shop.modules.instagram || shop.modules.whatsapp) && (
            <SettingsSection id="instagram-whatsapp">
              <ChannelsCard
                zernio={zernio}
                instagram={shop.modules.instagram}
                whatsapp={shop.modules.whatsapp}
              />
            </SettingsSection>
          )}
          {shop.modules.instagram && (
            <SettingsSection id="dbot-instagram">
              <DirectBotCard platform="instagram" />
            </SettingsSection>
          )}
          {shop.modules.instagram && shop.modules.dm_shop && (
            <SettingsSection id="ice-breakers">
              <IceBreakersCard />
            </SettingsSection>
          )}
          {shop.modules.whatsapp && (
            <SettingsSection id="dbot-whatsapp">
              <DirectBotCard platform="whatsapp" />
            </SettingsSection>
          )}
          <SettingsSection id="shop">
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
                {shop.modules.web_storefront && (
                  <Field
                    label={t("settings.shop.webCheckout")}
                    hint={t("settings.shop.webCheckoutHint")}
                  >
                    <input
                      type="checkbox"
                      name="storefront_checkout"
                      defaultChecked={
                        parseWebCheckout(settings.storefront_checkout ?? null).enabled
                      }
                    />
                  </Field>
                )}
                {shop.modules.web_storefront && (
                  <Field label={t("settings.shop.tgLogin")} hint={t("settings.shop.tgLoginHint")}>
                    <input
                      type="checkbox"
                      name="storefront_tg_login"
                      defaultChecked={
                        parseWebCheckout(settings.storefront_checkout ?? null).tgLogin
                      }
                    />
                  </Field>
                )}
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
                {shop.modules.loyalty && (
                  <Field
                    label={t("settings.shop.loyaltyMaxRedeem")}
                    hint={t("settings.shop.loyaltyMaxRedeemHint")}
                  >
                    <input
                      className="input w-32"
                      name="loyalty_max_redeem_percent"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={settings.loyalty_max_redeem_percent ?? "100"}
                    />
                  </Field>
                )}
                {shop.modules.multi_language && (
                  <Field
                    label={t("settings.shop.langTiming")}
                    hint={t("settings.shop.langTimingHint")}
                  >
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
                {(shop.modules.instagram || shop.modules.whatsapp) && (
                  <Field
                    label={t("settings.shop.deliveryNote")}
                    hint={t("settings.shop.deliveryNoteHint")}
                  >
                    <textarea
                      className="input"
                      name="delivery_email_note"
                      rows={3}
                      maxLength={DELIVERY_NOTE_MAX}
                      defaultValue={settings.delivery_email_note ?? ""}
                    />
                  </Field>
                )}
                <div className="flex items-center gap-3">
                  <button className="btn-primary" disabled={save.busy}>
                    {t("common.save")}
                  </button>
                  {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
                </div>
                <ErrorBox error={save.error} />
              </form>
            </Card>
          </SettingsSection>
          <SettingsSection id="payment-methods">
            <PaymentMethods methods={methods} />
          </SettingsSection>
          <SettingsSection id="fulfillment">
            <FulfillmentCard settings={settings} />
          </SettingsSection>
          <SettingsSection id="min-order">
            <MinOrderCard />
          </SettingsSection>
          {shop.modules.bundles && (
            <SettingsSection id="gift-wrap">
              <GiftWrapCard />
            </SettingsSection>
          )}
          <SettingsSection id="community">
            <CommunityCard />
          </SettingsSection>
          <SettingsSection id="about">
            <AboutCard />
          </SettingsSection>
          <SettingsSection id="design">
            <DesignCard />
          </SettingsSection>
          <SettingsSection id="marketplace">
            <MarketplaceCard />
          </SettingsSection>
          <SettingsSection id="zones">
            <ZonesCard zones={zones} />
          </SettingsSection>
          <SettingsSection id="free-delivery">
            <FreeDeliveryCard />
          </SettingsSection>
          <SettingsSection id="watermark">
            <WatermarkCard enabled={pdfWatermark} />
          </SettingsSection>
          {shop.modules.robokassa && (
            <SettingsSection id="robokassa">
              <RobokassaCard settings={settings} />
            </SettingsSection>
          )}
          {shop.modules.crypto && shop.role === "owner" && (
            <SettingsSection id="crypto">
              <CryptoCard settings={settings} />
            </SettingsSection>
          )}
          {shop.modules.stripe && shop.role === "owner" && (
            <SettingsSection id="stripe">
              <StripeCard settings={settings} />
            </SettingsSection>
          )}
          {shop.modules.telegram_stars && (
            <SettingsSection id="stars">
              <StarsCard settings={settings} />
            </SettingsSection>
          )}
          {shop.modules.receipt_ocr && (
            <SettingsSection id="receipt-ocr">
              <ReceiptOcrCard settings={settings} hasKey={visionKey} />
            </SettingsSection>
          )}
          {shop.modules.smart_search && (
            <SettingsSection id="smart-search">
              <SmartSearchCard settings={settings} hasKey={smartSearchKey} />
            </SettingsSection>
          )}
          <SettingsSection id="weekly">
            <WeeklyReportCard settings={settings} />
          </SettingsSection>
          <SettingsSection id="auto-v3">
            <AutoMessagesCard settings={settings} />
          </SettingsSection>
          <SettingsSection id="service-notices">
            <ServiceNoticesCard settings={settings} />
          </SettingsSection>
          <SettingsSection id="pay-remind">
            <PayReminderCard settings={settings} />
          </SettingsSection>
          {shop.modules.legal_docs && (
            <SettingsSection id="legal">
              <LegalCard settings={settings} />
            </SettingsSection>
          )}
          {shop.modules.notify_in_bot && (
            <SettingsSection id="notify">
              <NotifyCard />
            </SettingsSection>
          )}
          {shop.modules.stock && (
            <SettingsSection id="low-stock">
              <LowStockCard />
            </SettingsSection>
          )}
          <SettingsSection id="push">
            <PushCard />
          </SettingsSection>
          {shop.modules.crm_integration && (
            <SettingsSection id="crm">
              <CrmCard />
            </SettingsSection>
          )}
          {shop.modules.public_api && shop.role === "owner" && (
            <SettingsSection id="api">
              <ApiKeyCard />
            </SettingsSection>
          )}
          {shop.modules.admin_roles && (
            <SettingsSection id="team">
              <TeamCard />
            </SettingsSection>
          )}
          {shop.role === "owner" && (
            <SettingsSection id="takeout">
              <TakeoutCard />
            </SettingsSection>
          )}
          {shop.role === "owner" && (
            <SettingsSection id="invite">
              <InviteCard />
            </SettingsSection>
          )}
          {shop.role === "owner" && !shop.deletionAt && (
            <SettingsSection id="delete">
              <DeleteShopCard locale={shop.locale} shopName={shop.name} />
            </SettingsSection>
          )}
        </div>
      </SettingsFilterProvider>
    </>
  );
}
