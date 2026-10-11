import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { adminLogout } from "@/app/admin/admin-auth.functions";
import {
  adminShopFn,
  adminShopsFn,
  setAdminLocaleFn,
  switchShopFn,
} from "@/app/admin/shop.functions";
import { ADMIN_LOCALE_LABELS, adminT } from "@/app/i18n/admin";
import { Badge, PageTitleAddon, Shell, ThemeToggle } from "@/app/ui";
import { HelpPanelProvider, PageHelp } from "@/app/admin/help-panel";
import { AdminBottomBar, AdminNavLinks } from "@/app/admin/admin-nav";
import { buildAdminNav } from "@/app/admin/nav-model";
import { DeletionBanner } from "@/app/admin/deletion-ui";
import { SubscriptionBanner } from "@/app/admin/subscription-banner";
import { TrialBanner } from "@/app/admin/trial-banner";
import { CommandPalette } from "@/app/admin/command-palette";
import { CreateMenu } from "@/app/admin/create-menu";
import { createActions } from "@/app/admin/create-actions";
import { SupportFab } from "@/app/admin/support-fab";
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
  const owner = shop.role === "owner";
  const nav = buildAdminNav(shop);
  const create = createActions(nav, shop);
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
          <CreateMenu actions={create} t={t} />
          <AdminNavLinks nav={nav} t={t} />
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
      <div className="pb-16 md:pb-0">
        <HelpPanelProvider locale={shop.locale} t={t}>
          <PageTitleAddon.Provider value={<PageHelp />}>
            <Outlet />
          </PageTitleAddon.Provider>
        </HelpPanelProvider>
      </div>
      <button
        type="button"
        aria-label={t("palette.open")}
        className="btn-ghost fixed right-14 top-1.5 z-30 md:hidden"
        onClick={() => window.dispatchEvent(new Event("admin:search"))}
      >
        🔍
      </button>
      <CommandPalette
        locale={shop.locale}
        shop={shop}
        actions={create.map((a) => ({ label: t(a.label), to: a.to, params: a.params }))}
        sections={[nav.overview, ...nav.groups.flatMap((g) => g.items)].map((i) => ({
          label: t(i.label),
          to: i.to,
          hash: i.hash,
        }))}
      />
      <SupportFab t={t} enabled={shop.role !== "accountant"} />
      <AdminBottomBar nav={nav} t={t} />
    </Shell>
  );
}
