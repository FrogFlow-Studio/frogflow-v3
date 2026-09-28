import { createFileRoute, Outlet } from "@tanstack/react-router";
import { panelHeaders } from "@/app/auth/panel-headers";

export const Route = createFileRoute("/admin")({
  // Админка ставится на телефон как приложение (PWA): манифест, значок, цвет.
  head: () => ({
    meta: [
      { title: "FrogFlow · Магазин" },
      { name: "theme-color", content: "#16a34a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "manifest", href: "/api/admin/manifest" },
      { rel: "apple-touch-icon", href: "/api/admin/icon" },
    ],
  }),
  headers: panelHeaders,
  component: () => <Outlet />,
});
