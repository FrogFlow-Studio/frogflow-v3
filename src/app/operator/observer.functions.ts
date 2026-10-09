import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции страницы «Наблюдатель» (ИИ-наблюдатель за диалогами).
 * Каждая начинается с requireOperator(): маршрутный гейт — только UX.
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();
const impl = () => import("@/app/observer/observer-view.server");

export const observerOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).observerOverview();
});

export const setObserverFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        enabled: z.boolean().optional(),
        cap: z.number().min(0).max(50).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setObserver(data.botId, { enabled: data.enabled, cap: data.cap });
    return { ok: true };
  });
