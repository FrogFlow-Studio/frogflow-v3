import { createFileRoute } from "@tanstack/react-router";

/** Иконка витрины на экране телефона (app/storefront/share.server). */
export const Route = createFileRoute("/s/$slug_/icon/$size")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { iconResponse } = await import("@/app/storefront/share.server");
        return iconResponse(params.slug, params.size);
      },
    },
  },
});
