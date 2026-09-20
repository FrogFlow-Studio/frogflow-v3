import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/operator")({
  head: () => ({ meta: [{ title: "FrogFlow · Оператор" }] }),
  component: () => <Outlet />,
});
