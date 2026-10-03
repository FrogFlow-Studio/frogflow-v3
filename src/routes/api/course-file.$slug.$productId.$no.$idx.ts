import { createFileRoute } from "@tanstack/react-router";

/**
 * Файл открытого урока со страницы курса: подпись хранилища ставится при
 * переходе (app/storefront/course-file.server), а не при показе карточки.
 */
export const Route = createFileRoute("/api/course-file/$slug/$productId/$no/$idx")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { courseFileResponse } = await import("@/app/storefront/course-file.server");
        return courseFileResponse(params.slug, params.productId, params.no, params.idx);
      },
    },
  },
});
