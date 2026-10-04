import { createFileRoute } from "@tanstack/react-router";

/** Страница «нет сети» витрины: service worker показывает её, когда открыть магазин не удаётся. */
export const Route = createFileRoute("/s/$slug_/offline")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { offlineResponse } = await import("@/app/storefront/share.server");
        return offlineResponse(params.slug);
      },
    },
  },
});
