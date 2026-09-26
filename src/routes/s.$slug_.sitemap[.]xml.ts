import { createFileRoute } from "@tanstack/react-router";

/** Карта сайта витрины (app/storefront/sitemap.server). */
export const Route = createFileRoute("/s/$slug_/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { shopSitemapResponse } = await import("@/app/storefront/sitemap.server");
        return shopSitemapResponse(request, params.slug);
      },
    },
  },
});
