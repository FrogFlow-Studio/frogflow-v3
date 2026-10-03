import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  adminLogout,
  adminShopFn,
  adminShopsFn,
  setAdminLocaleFn,
  switchShopFn,
} from "@/app/admin/admin.functions";
import { ADMIN_LOCALE_LABELS, adminT } from "@/app/i18n/admin";
import { Badge, NavLink, Shell, ThemeToggle } from "@/app/ui";
import { DeletionBanner } from "@/app/admin/deletion-ui";
import { SubscriptionBanner } from "@/app/admin/subscription-banner";
import { TrialBanner } from "@/app/admin/trial-banner";
import { CommandPalette } from "@/app/admin/command-palette";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

export const Route = createFileRoute("/admin/_authed")({
  beforeLoad: async () => {
    const shop = await adminShopFn();
    if (!shop) throw redirect({ to: "/admin/login" });
    // «Несколько ботов»: связанные магазины владельца; сбой — просто без переключателя.
    const group = await adminShopsFn().catch(() => null);
    return { shop, group };
  },
  component: Layout,
});

function Layout() {
  const { shop, group } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const t = adminT(shop.locale);
  // Язык страницы — для чтения с экрана и текста ошибок (ui/ErrorBox).
  useEffect(() => {
    document.documentElement.lang = shop.locale;
    return () => {
      document.documentElement.lang = "ru";
    };
  }, [shop.locale]);
  const physical = shop.vertical === "confectionery" || shop.vertical === "flowers";
  const owner = shop.role === "owner";
  const school = shop.vertical === "courses";
  const switchLocale = async (locale: Locale) => {
    await setAdminLocaleFn({ data: { locale } });
    await router.invalidate();
  };
  const switchShop = async (botId: string) => {
    await switchShopFn({ data: { botId } });
    // Страница прежнего магазина (заказ, товар) в новом не существует — на обзор.
    await navigate({ to: "/admin" });
    await router.invalidate();
  };
  return (
    <Shell
      brand={
        <span className="flex items-center gap-2 truncate">
          {shop.name}
          {shop.status !== "active" && <Badge tone="warn">{t("nav.paused")}</Badge>}
        </span>
      }
      nav={
        <>
          <NavLink to="/admin" activeOptions={{ exact: true }}>
            {t("nav.overview")}
          </NavLink>
          <NavLink to="/admin/orders">{t("nav.orders")}</NavLink>
          {shop.modules.dashboard && <NavLink to="/admin/analytics">{t("nav.analytics")}</NavLink>}
          <NavLink to="/admin/billing">{t("billing.nav")}</NavLink>
          {/* Бухгалтеру — только обзор, заказы и аналитика (сервер закрывает остальное сам). */}
          {shop.role !== "accountant" && (
            <>
              {school ? (
                // Онлайн-школа: курсы, ученики и задания — первыми.
                <>
                  <NavLink to="/admin/products">{t("nav.courses")}</NavLink>
                  {shop.modules.courses && (
                    <NavLink to="/admin/students">{t("nav.students")}</NavLink>
                  )}
                  {shop.modules.courses && (
                    <NavLink to="/admin/homework">
                      {t("homework.nav")}
                      {shop.homeworkWaiting > 0 && (
                        <Badge tone="warn">{shop.homeworkWaiting}</Badge>
                      )}
                    </NavLink>
                  )}
                </>
              ) : (
                <NavLink to="/admin/products">{t("nav.products")}</NavLink>
              )}
              <NavLink to="/admin/categories">{t("nav.categories")}</NavLink>
              <NavLink to="/admin/customers">{t("nav.customers")}</NavLink>
              {shop.modules.review_request && (
                <NavLink to="/admin/reviews">{t("nav.reviews")}</NavLink>
              )}
              {shop.modules.crm_pipeline && (
                <NavLink to="/admin/pipeline">{t("nav.pipeline")}</NavLink>
              )}
              {shop.modules.manager_chat && (
                <NavLink to="/admin/chat">
                  <span className="flex items-center justify-between gap-2">
                    {t("nav.chat")}
                    {shop.chatUnread > 0 && <Badge tone="accent">{shop.chatUnread}</Badge>}
                  </span>
                </NavLink>
              )}
              {shop.modules.helpdesk && shop.modules.manager_chat && (
                <NavLink to="/admin/tickets">
                  <span className="flex items-center justify-between gap-2">
                    {t("nav.tickets")}
                    {shop.ticketsOpen > 0 && <Badge tone="accent">{shop.ticketsOpen}</Badge>}
                  </span>
                </NavLink>
              )}
              {(shop.modules.coupons ||
                shop.modules.gift_certificates ||
                shop.modules.referral ||
                shop.modules.limited_offers) && (
                <NavLink to="/admin/discounts">{t("nav.discounts")}</NavLink>
              )}
              {(shop.modules.broadcasts ||
                shop.modules.wa_broadcasts ||
                shop.modules.winback ||
                shop.modules.funnel) && (
                <NavLink to="/admin/broadcasts">{t("nav.broadcasts")}</NavLink>
              )}
              <NavLink to="/admin/consultant">{t("nav.consultant")}</NavLink>
              {shop.pricelist && <NavLink to="/admin/pricelist">{t("pricelist.nav")}</NavLink>}
              {!school && shop.modules.courses && (
                <NavLink to="/admin/homework">
                  {t("homework.nav")}
                  {shop.homeworkWaiting > 0 && <Badge tone="warn">{shop.homeworkWaiting}</Badge>}
                </NavLink>
              )}
              {shop.modules.instagram && (
                <NavLink to="/admin/instagram">{t("nav.instagram")}</NavLink>
              )}
              {shop.modules.instagram && <NavLink to="/admin/posts">{t("nav.posts")}</NavLink>}
              {shop.modules.vip && <NavLink to="/admin/vip">{t("nav.vip")}</NavLink>}
              {shop.modules.quiz && <NavLink to="/admin/quiz">{t("nav.quiz")}</NavLink>}
              <NavLink to="/admin/ai-balance">{t("nav.aiBalance")}</NavLink>
              <NavLink to="/admin/bot-preview">{t("nav.botPreview")}</NavLink>
              {shop.undelivered > 0 && (
                <NavLink to="/admin/undelivered">
                  <span className="flex items-center justify-between gap-2">
                    {t("nav.undelivered")}
                    <Badge tone="danger">{shop.undelivered}</Badge>
                  </span>
                </NavLink>
              )}
              {owner && (
                <NavLink to="/admin/settings">
                  {physical ? t("nav.settingsPhysical") : t("nav.settings")}
                </NavLink>
              )}
              {owner && <NavLink to="/admin/modules">{t("nav.modules")}</NavLink>}
              {owner && <NavLink to="/admin/log">{t("audit.nav")}</NavLink>}
            </>
          )}
        </>
      }
      user={
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="truncate">{shop.username}</span>
            <Badge tone={owner ? "accent" : "neutral"}>{t(`role.${shop.role}`)}</Badge>
          </div>
          {group && group.shops.length > 1 && (
            <select
              className="input h-8 w-full text-xs"
              value={group.current}
              aria-label={t("nav.shop")}
              onChange={(e) => void switchShop(e.target.value)}
            >
              {group.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="input h-8 w-full text-xs"
            value={shop.locale}
            aria-label={t("nav.language")}
            onChange={(e) => void switchLocale(e.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {ADMIN_LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => void adminLogout().then(() => navigate({ to: "/admin/login" }))}
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>
      }
    >
      {shop.deletionAt && (
        <DeletionBanner
          locale={shop.locale}
          deletionAt={shop.deletionAt}
          owner={shop.role === "owner"}
        />
      )}
      {shop.trial && <TrialBanner locale={shop.locale} trial={shop.trial} owner={owner} />}
      {shop.subscription && (
        <SubscriptionBanner locale={shop.locale} sub={shop.subscription} owner={owner} />
      )}
      <Outlet />
      <CommandPalette locale={shop.locale} />
    </Shell>
  );
}
