import { createServerFn } from "@tanstack/react-start";

/** Список воронок v4 на экране рассылок. Смотреть может вся команда. */
export const v4FunnelsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  const { loadV4Funnels } = await import("./v4-funnels.server");
  return loadV4Funnels(ctx);
});
