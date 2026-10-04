import { createFileRoute } from "@tanstack/react-router";

/** Service worker витрины для установки на телефон и страницы «нет сети» (app/storefront/share.server). */
export const Route = createFileRoute("/s/$slug_/sw.js")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { swResponse } = await import("@/app/storefront/share.server");
        return swResponse(params.slug);
      },
    },
  },
});
