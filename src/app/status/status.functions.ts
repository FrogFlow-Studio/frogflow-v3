import { createServerFn } from "@tanstack/react-start";

/** Публичный статус платформы: без данных клиентов (app/status/status). */
export const platformStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { platformStatus } = await import("./status.server");
  return platformStatus();
});
