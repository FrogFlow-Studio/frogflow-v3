import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { adminLogout, adminShopFn, setAdminLocaleFn } from "@/app/admin/admin.functions";
import { ADMIN_LOCALE_LABELS, adminT } from "@/app/i18n/admin";
import { Badge, NavLink, Shell, ThemeToggle } from "@/app/ui";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

export const Route = createFileRoute("/admin/_authed")({
  beforeLoad: async () => {
    const shop = await adminShopFn();
    if (!shop) throw redirect({ to: "/admin/login" });
    return { shop };
  },
  component: Layout,
});

function Layout() {
  const { shop } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const t = adminT(shop.locale);
  const physical = shop.vertical === "confectionery" || shop.vertical === "flowers";
  const owner = shop.role === "owner";
  const switchLocale = async (locale: Locale) => {
    await setAdminLocaleFn({ data: { locale } });
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
          <NavLink to="/admin/products">{t("nav.products")}</NavLink>
          <NavLink to="/admin/categories">{t("nav.categories")}</NavLink>
          <NavLink to="/admin/customers">{t("nav.customers")}</NavLink>
          {shop.modules.manager_chat && (
            <NavLink to="/admin/chat">
              <span className="flex items-center justify-between gap-2">
                {t("nav.chat")}
                {shop.chatUnread > 0 && <Badge tone="accent">{shop.chatUnread}</Badge>}
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
            shop.modules.funnel) && <NavLink to="/admin/broadcasts">{t("nav.broadcasts")}</NavLink>}
          <NavLink to="/admin/consultant">{t("nav.consultant")}</NavLink>
          {shop.modules.instagram && <NavLink to="/admin/instagram">{t("nav.instagram")}</NavLink>}
          {shop.modules.instagram && <NavLink to="/admin/posts">{t("nav.posts")}</NavLink>}
          {shop.modules.vip && <NavLink to="/admin/vip">{t("nav.vip")}</NavLink>}
          {shop.modules.quiz && <NavLink to="/admin/quiz">{t("nav.quiz")}</NavLink>}
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
        </>
      }
      user={
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="truncate">{shop.username}</span>
            <Badge tone={owner ? "accent" : "neutral"}>{t(`role.${shop.role}`)}</Badge>
          </div>
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
      <Outlet />
    </Shell>
  );
}
