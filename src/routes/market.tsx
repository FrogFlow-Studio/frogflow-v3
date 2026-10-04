import { Outlet, createFileRoute } from "@tanstack/react-router";

/** Площадка FrogFlow: общая оболочка страниц /market, /market/search, /market/open … */
export const Route = createFileRoute("/market")({
  component: () => <Outlet />,
});
