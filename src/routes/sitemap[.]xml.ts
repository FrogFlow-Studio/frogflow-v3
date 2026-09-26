import { createFileRoute } from "@tanstack/react-router";

/** Индекс карт витрин; на домене магазина — его карта (app/storefront/sitemap.server). */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { rootSitemapResponse } = await import("@/app/storefront/sitemap.server");
        return rootSitemapResponse(request);
      },
    },
  },
});
