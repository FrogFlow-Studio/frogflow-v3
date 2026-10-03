import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Отчёт агентства-партнёра по подписанной ссылке (core/partners): без входа,
 * доступ — подпись кода секретом платформы; только его клиенты, без контактов.
 */
export const partnerReportFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ code: z.string().max(30), t: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const { partnerReportOrFail } = await import("@/app/operator/partners.server");
    return partnerReportOrFail(data.code, data.t);
  });
