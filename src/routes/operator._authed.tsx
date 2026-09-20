import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { operatorCheck, operatorLogout } from "@/app/operator/operator.functions";
import { NavLink, Shell, ThemeToggle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed")({
  beforeLoad: async () => {
    const { authed } = await operatorCheck();
    if (!authed) throw redirect({ to: "/operator/login" });
  },
  component: Layout,
});

function Layout() {
  const navigate = useNavigate();
  return (
    <Shell
      brand="🐸 FrogFlow · оператор"
      nav={
        <>
          <NavLink to="/operator" activeOptions={{ exact: true }}>
            Клиенты
          </NavLink>
          <NavLink to="/operator/clients/new">Подключить клиента</NavLink>
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
