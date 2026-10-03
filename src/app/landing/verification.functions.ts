import { createServerFn } from "@tanstack/react-start";

/** Коды подтверждения сайта в поисковиках для метатегов главной (config/env). */
export const siteVerificationFn = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("@/config/env");
  return { yandex: env().YANDEX_VERIFICATION ?? null };
});
