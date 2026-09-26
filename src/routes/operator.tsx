import { createFileRoute, Outlet } from "@tanstack/react-router";
import { panelHeaders } from "@/app/auth/panel-headers";

export const Route = createFileRoute("/operator")({
  head: () => ({ meta: [{ title: "FrogFlow · Оператор" }] }),
  headers: panelHeaders,
  component: () => <Outlet />,
});
