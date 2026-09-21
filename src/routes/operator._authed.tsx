import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import {
  operatorCheck,
  operatorLogout,
  pendingRequestCountFn,
} from "@/app/operator/operator.functions";
import { Badge, NavLink, Shell, ThemeToggle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed")({
  beforeLoad: async () => {
    const { authed } = await operatorCheck();
    if (!authed) throw redirect({ to: "/operator/login" });
    return { pendingRequests: await pendingRequestCountFn().catch(() => 0) };
  },
  component: Layout,
});

function Layout() {
  const navigate = useNavigate();
  const { pendingRequests } = Route.useRouteContext();
  return (
    <Shell
      brand="🐸 FrogFlow · оператор"
      nav={
        <>
          <NavLink to="/operator" activeOptions={{ exact: true }}>
            Клиенты
          </NavLink>
          <NavLink to="/operator/clients/new">Подключить клиента</NavLink>
          <NavLink to="/operator/broadcast">Сообщение владельцам</NavLink>
          <NavLink to="/operator/settings">Настройки</NavLink>
          <NavLink to="/operator/requests">
            <span className="flex items-center justify-between gap-2">
              Заявки на модули
              {pendingRequests > 0 && <Badge tone="accent">{pendingRequests}</Badge>}
            </span>
          </NavLink>
        </>
      }
      user={
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              void operatorLogout().then(() => navigate({ to: "/operator/login" }));
            }}
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
