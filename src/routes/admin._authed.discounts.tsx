import { createFileRoute } from "@tanstack/react-router";
import { loyaltyTiersFn } from "@/app/admin/loyalty.functions";
import { giftCertificatesFn, giftSaleFn, promoCodesFn } from "@/app/admin/promos.functions";
import { settingsFn } from "@/app/admin/settings.functions";
import { AskCommunityAdvice } from "@/app/admin/community-ask";
import { adminT } from "@/app/i18n/admin";
import { PageTitle } from "@/app/ui";
import { PromoCard } from "@/app/admin/discounts/promo-card";
import { GiftCard } from "@/app/admin/discounts/gift-card";
import { GiftSaleCard } from "@/app/admin/discounts/gift-sale-card";
import { ReferralCard, ReferralReportCard } from "@/app/admin/discounts/referral";
import { TiersCard } from "@/app/admin/discounts/tiers-card";
import { OffersCard } from "@/app/admin/discounts/offers-card";

export const Route = createFileRoute("/admin/_authed/discounts")({
  // Из отчёта «Залежавшийся товар»: id товаров через запятую — очередь для акций.
  validateSearch: (s: Record<string, unknown>): { offerProducts?: string } => ({
    offerProducts: typeof s.offerProducts === "string" ? s.offerProducts.slice(0, 800) : undefined,
  }),
  loader: async () => {
    const [promos, gifts, settings, giftSale, tiers] = await Promise.all([
      promoCodesFn(),
      giftCertificatesFn(),
      settingsFn(),
      giftSaleFn(),
      loyaltyTiersFn().catch(() => null),
    ]);
    return {
      tiers,
      promos,
      gifts,
      giftSale,
      referralPercent: settings.settings.referral_discount_percent ?? "",
    };
  },
  component: DiscountsPage,
});

function DiscountsPage() {
  const { promos, gifts, giftSale, referralPercent, tiers } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  return (
    <>
      <PageTitle title={t("discounts.title")} subtitle={t("discounts.subtitle")} />
      <AskCommunityAdvice page="discounts" t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        {shop.modules.coupons && <PromoCard promos={promos} />}
        {shop.modules.gift_certificates && (
          <GiftCard gifts={gifts} currency={promos[0] ? "KZT" : "KZT"} />
        )}
        {shop.modules.gift_certificates && <GiftSaleCard sale={giftSale} />}
        {shop.modules.referral && <ReferralCard percent={referralPercent} bot={shop.telegram} />}
        {shop.modules.referral && <ReferralReportCard />}

        {shop.modules.loyalty && tiers && <TiersCard tiers={tiers} />}
        {shop.modules.limited_offers && <OffersCard />}
      </div>
    </>
  );
}
