import { DeleteShopCard } from "@/app/admin/deletion-ui";
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
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { DELIVERY_NOTE_MAX } from "@/core/delivery/note";
import { adminT } from "@/app/i18n/admin";
import { parseWebCheckout } from "@/core/storefront/web-checkout-settings";
import { ChannelsCard, DirectBotCard, TelegramCard } from "@/app/admin/settings/channels";
import { CrmCard } from "@/app/admin/settings/crm";
import { ApiKeyCard } from "@/app/admin/settings/api-key";
import { PushCard } from "@/app/admin/settings/push";
import { IceBreakersCard } from "@/app/admin/settings/ice-breakers";
import { FulfillmentCard, ZonesCard } from "@/app/admin/settings/delivery";
import { MinOrderCard } from "@/app/admin/settings/min-order";
import { GiftWrapCard } from "@/app/admin/settings/gift-wrap";
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
} from "@/app/admin/settings/shop";
import { TeamCard } from "@/app/admin/settings/team";
import { TakeoutCard } from "@/app/admin/settings/takeout";
import { InviteCard } from "@/app/admin/settings/invite";

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
        {shop.modules.instagram && shop.modules.dm_shop && <IceBreakersCard />}
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
            {shop.modules.web_storefront && (
              <Field
                label={t("settings.shop.webCheckout")}
                hint={t("settings.shop.webCheckoutHint")}
              >
                <input
                  type="checkbox"
                  name="storefront_checkout"
                  defaultChecked={parseWebCheckout(settings.storefront_checkout ?? null).enabled}
                />
              </Field>
            )}
            {shop.modules.web_storefront && (
              <Field label={t("settings.shop.tgLogin")} hint={t("settings.shop.tgLoginHint")}>
                <input
                  type="checkbox"
                  name="storefront_tg_login"
                  defaultChecked={parseWebCheckout(settings.storefront_checkout ?? null).tgLogin}
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
        <PaymentMethods methods={methods} />
        <FulfillmentCard settings={settings} />
        <MinOrderCard />
        {shop.modules.bundles && <GiftWrapCard />}
        <CommunityCard />
        <ZonesCard zones={zones} />
        <FreeDeliveryCard />
        <WatermarkCard enabled={pdfWatermark} />
        {shop.modules.robokassa && <RobokassaCard settings={settings} />}
        {shop.modules.crypto && shop.role === "owner" && <CryptoCard settings={settings} />}
        {shop.modules.stripe && shop.role === "owner" && <StripeCard settings={settings} />}
        {shop.modules.telegram_stars && <StarsCard settings={settings} />}
        {shop.modules.receipt_ocr && <ReceiptOcrCard settings={settings} hasKey={visionKey} />}
        {shop.modules.smart_search && (
          <SmartSearchCard settings={settings} hasKey={smartSearchKey} />
        )}
        <WeeklyReportCard settings={settings} />
        <PayReminderCard settings={settings} />
        {shop.modules.legal_docs && <LegalCard settings={settings} />}
        {shop.modules.notify_in_bot && <NotifyCard />}
        {shop.modules.stock && <LowStockCard />}
        <PushCard />
        {shop.modules.crm_integration && <CrmCard />}
        {shop.modules.public_api && shop.role === "owner" && <ApiKeyCard />}
        {shop.modules.admin_roles && <TeamCard />}
        {shop.role === "owner" && <TakeoutCard />}
        {shop.role === "owner" && <InviteCard />}
        {shop.role === "owner" && !shop.deletionAt && (
          <DeleteShopCard locale={shop.locale} shopName={shop.name} />
        )}
      </div>
    </>
  );
}
