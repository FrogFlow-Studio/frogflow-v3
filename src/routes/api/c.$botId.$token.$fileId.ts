import { withNoStore } from "@/app/cache-policy";
import { createFileRoute } from "@tanstack/react-router";

/** Файл из кабинета покупателя v4: подпись хранилища ставится при переходе. */
export const Route = createFileRoute("/api/c/$botId/$token/$fileId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { cabinetFileResponse } = await import("@/app/cabinet/cabinet.server");
        return withNoStore(await cabinetFileResponse(params.botId, params.token, params.fileId));
      },
    },
  },
});
