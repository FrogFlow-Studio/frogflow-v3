import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { operatorCheck, operatorLogout } from "@/app/operator/operator-auth.functions";
import { pendingRequestCountFn } from "@/app/operator/owner-messages.functions";
import { OperatorBottomBar, OperatorSideNav } from "@/app/operator/OperatorMenu";
import { Shell, ThemeToggle } from "@/app/ui";

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
      nav={<OperatorSideNav pending={pendingRequests} />}
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
      <div className="h-16 md:hidden" aria-hidden />
      <OperatorBottomBar pending={pendingRequests} />
    </Shell>
  );
}
