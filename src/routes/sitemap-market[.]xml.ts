import { createFileRoute } from "@tanstack/react-router";

/** Карта площадки: авторы и их товары, только видимые и только v2 (app/storefront/sitemap.server). */
export const Route = createFileRoute("/sitemap-market.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { marketSitemapResponse } = await import("@/app/storefront/sitemap.server");
        return marketSitemapResponse(request);
      },
    },
  },
});
