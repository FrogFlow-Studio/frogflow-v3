import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { operatorCheck, operatorLogout } from "@/app/operator/operator-auth.functions";
import { pendingRequestCountFn } from "@/app/operator/owner-messages.functions";
import { OPERATOR_MENU } from "@/app/operator/menu";
import { ThemeToggle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed")({
  beforeLoad: async () => {
    const { authed } = await operatorCheck();
    if (!authed) throw redirect({ to: "/operator/login" });
    return { pendingRequests: await pendingRequestCountFn().catch(() => null) };
  },
  component: Layout,
});

function Layout() {
  const navigate = useNavigate();
  const { pendingRequests } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const group = OPERATOR_MENU.find((g) =>
    g.items.some(
      (item) =>
        item.to !== "/operator" && (pathname === item.to || pathname.startsWith(item.to + "/")),
    ),
  );
  const currentItem = group?.items.find((item) => pathname === item.to);
  return (
    <div className="operator-workspace operator-studio">
      <header className="operator-appbar">
        <Link to="/operator" className="operator-brand">
          🐸 FrogFlow <small>Управление платформой</small>
        </Link>
        <div className="operator-account">
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
      </header>
      <nav className="operator-primary-nav" aria-label="Рабочие области">
        <Link to="/operator" activeOptions={{ exact: true }}>
          Обзор
        </Link>
        {OPERATOR_MENU.map((g) => {
          const first = g.items.find((i) => i.to !== "/operator")!;
          return (
            <Link key={g.id} to={first.to} data-active={group?.id === g.id}>
              {g.id === "work" ? "Входящие" : g.title}
              {g.id === "work" && (pendingRequests ?? 0) > 0 && <span>{pendingRequests}</span>}
            </Link>
          );
        })}
      </nav>
      <div className={group ? "operator-page-layout" : "operator-page-layout operator-page-full"}>
        {group && (
          <aside className="operator-context-nav">
            <p>{group.id === "work" ? "Входящие" : group.title}</p>
            <select
              className="operator-context-select input"
              aria-label="Раздел рабочей области"
              value={
                currentItem?.to ??
                (pathname.startsWith("/operator/clients/")
                  ? "/operator/clients"
                  : group.items[0]?.to)
              }
              onChange={(e) => {
                const item = group.items.find((i) => i.to === e.target.value);
                if (item) void navigate({ to: item.to });
              }}
            >
              {group.items
                .filter((i) => i.to !== "/operator")
                .map((item) => (
                  <option key={item.to} value={item.to}>
                    {item.label}
                  </option>
                ))}
            </select>
            <nav aria-label={group.title}>
              {group.items
                .filter((i) => i.to !== "/operator")
                .map((item) => (
                  <Link key={item.to} to={item.to} activeOptions={{ exact: true }}>
                    {item.label}
                    {item.badge && (pendingRequests ?? 0) > 0 && <span>{pendingRequests}</span>}
                  </Link>
                ))}
            </nav>
          </aside>
        )}
        <main className="operator-page-content" data-page={pathname.split("/")[2] ?? "overview"}>
          <div className="operator-breadcrumb">
            <Link to="/operator">Платформа</Link>
            <span>/</span>
            <span>{currentItem?.label ?? group?.title ?? "Обзор"}</span>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
