import { createFileRoute } from "@tanstack/react-router";

/** Манифест витрины для установки на телефон (app/storefront/share.server). */
export const Route = createFileRoute("/s/$slug_/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { manifestResponse } = await import("@/app/storefront/share.server");
        return manifestResponse(params.slug);
      },
    },
  },
});
