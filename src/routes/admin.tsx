import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "FrogFlow · Магазин" }] }),
  component: () => <Outlet />,
});
