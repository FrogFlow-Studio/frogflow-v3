import { createFileRoute, Outlet } from "@tanstack/react-router";
import { panelHeaders } from "@/app/auth/panel-headers";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "FrogFlow · Магазин" }] }),
  headers: panelHeaders,
  component: () => <Outlet />,
});
