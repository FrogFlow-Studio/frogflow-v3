import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: курс Продамуса продавца в карточке
 * клиента. Каждая начинается с requireOperator(): маршрутный гейт — только UX.
 * Реализация — в prodamus-rate.server.ts (не попадает в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const impl = () => import("./prodamus-rate.server");

const botId = z.string().uuid();

export const prodamusRateStateFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).prodamusRateState(data.botId);
  });

export const setProdamusRateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, rate: z.string().max(20) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setProdamusRate(data.botId, data.rate, await actor());
    return { ok: true as const };
  });
