import { createFileRoute } from "@tanstack/react-router";

/** Сбой из браузера — в Sentry (lib/client-error.server). Данных клиента не трогает. */
export const Route = createFileRoute("/api/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleClientError } = await import("@/lib/client-error.server");
        return handleClientError(request);
      },
    },
  },
});
