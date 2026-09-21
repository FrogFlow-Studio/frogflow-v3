import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { adminLogout, adminShopFn } from "@/app/admin/admin.functions";
import { Badge, NavLink, Shell, ThemeToggle } from "@/app/ui";

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
  const physical = shop.vertical === "confectionery" || shop.vertical === "flowers";
  return (
    <Shell
      brand={
        <span className="flex items-center gap-2 truncate">
          {shop.name}
          {shop.status !== "active" && <Badge tone="warn">пауза</Badge>}
        </span>
      }
      nav={
        <>
          <NavLink to="/admin" activeOptions={{ exact: true }}>
            Обзор
          </NavLink>
          <NavLink to="/admin/orders">Заказы</NavLink>
          {shop.modules.dashboard && <NavLink to="/admin/analytics">Аналитика</NavLink>}
          <NavLink to="/admin/products">Товары</NavLink>
          <NavLink to="/admin/categories">Категории</NavLink>
          <NavLink to="/admin/customers">Покупатели</NavLink>
          {shop.modules.manager_chat && (
            <NavLink to="/admin/chat">
              <span className="flex items-center justify-between gap-2">
                Чат
                {shop.chatUnread > 0 && <Badge tone="accent">{shop.chatUnread}</Badge>}
              </span>
            </NavLink>
          )}
          {(shop.modules.coupons || shop.modules.gift_certificates || shop.modules.referral) && (
            <NavLink to="/admin/discounts">Скидки</NavLink>
          )}
          {(shop.modules.broadcasts || shop.modules.wa_broadcasts) && (
            <NavLink to="/admin/broadcasts">Рассылки</NavLink>
          )}
          <NavLink to="/admin/consultant">ИИ-консультант</NavLink>
          {shop.modules.vip && <NavLink to="/admin/vip">VIP-подписки</NavLink>}
          <NavLink to="/admin/settings">
            {physical ? "Оплата и доставка" : "Оплата и настройки"}
          </NavLink>
          <NavLink to="/admin/modules">Модули</NavLink>
        </>
      }
      user={
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => void adminLogout().then(() => navigate({ to: "/admin/login" }))}
          >
            Выйти
          </button>
        </div>
      }
    >
      <Outlet />
    </Shell>
  );
}
