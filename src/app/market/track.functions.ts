import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logFailure } from "@/lib/log-failure";

/**
 * Счётчик площадки (В20). Публичная функция без входа и без cookie: считает посещение /market,
 * поиск, поиск без результата и переход в магазин. Ответ всегда одинаковый, чтобы по нему нельзя
 * было ничего выведать; сбой записи покупателю не показывается.
 */
export const trackMarketFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["visit", "search", "empty", "click"]),
        key: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const { getRequestIP, getRequestHeader } = await import("@tanstack/react-start/server");
      const { env } = await import("@/config/env");
      const { recordMarketEvent } = await import("@/core/marketplace/analytics.server");
      await recordMarketEvent({
        kind: data.kind,
        key: data.key,
        ip: getRequestIP({ xForwardedFor: true }) ?? "",
        ua: getRequestHeader("user-agent") ?? "",
        secret: env().SESSION_SECRET,
      });
    } catch (e) {
      logFailure("market.track", e);
    }
    return { ok: true as const };
  });
