import { createFileRoute } from "@tanstack/react-router";

/** robots.txt: что не индексировать и где карта сайта (app/storefront/sitemap.server). */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { robotsResponse } = await import("@/app/storefront/sitemap.server");
        return robotsResponse(request);
      },
    },
  },
});
