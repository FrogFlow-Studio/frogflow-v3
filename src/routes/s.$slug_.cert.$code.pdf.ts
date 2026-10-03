import { createFileRoute } from "@tanstack/react-router";

/** PDF сертификата по коду (app/storefront/certificate.server). */
export const Route = createFileRoute("/s/$slug_/cert/$code/pdf")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { certificateResponse } = await import("@/app/storefront/certificate.server");
        return certificateResponse(params.slug, params.code);
      },
    },
  },
});
