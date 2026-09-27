import { createFileRoute } from "@tanstack/react-router";

/** Карта страниц платформы: главная и страницы ниш (app/storefront/sitemap.server). */
export const Route = createFileRoute("/sitemap-pages.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { pagesSitemapResponse } = await import("@/app/storefront/sitemap.server");
        return pagesSitemapResponse(request);
      },
    },
  },
});
