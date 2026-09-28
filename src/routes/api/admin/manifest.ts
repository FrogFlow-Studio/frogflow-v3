import { createFileRoute } from "@tanstack/react-router";

/** Манифест админки как приложения (PWA): ставится на телефон, открывается без адресной строки. */
const MANIFEST = {
  name: "FrogFlow · Магазин",
  short_name: "FrogFlow",
  description: "Заказы, товары и покупатели вашего магазина",
  start_url: "/admin",
  scope: "/admin",
  display: "standalone",
  background_color: "#0f1411",
  theme_color: "#16a34a",
  icons: [
    { src: "/api/admin/icon", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/api/admin/icon?maskable=1", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
  ],
};

export const Route = createFileRoute("/api/admin/manifest")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(MANIFEST), {
          headers: {
            "content-type": "application/manifest+json; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
