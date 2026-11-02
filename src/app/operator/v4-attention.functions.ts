import { createServerFn } from "@tanstack/react-start";

/** «Внимание (v4)»: только чтение. Начинается с requireOperator(): маршрутный гейт — только UX. */
export const v4AttentionFn = createServerFn({ method: "GET" }).handler(async () => {
  await (await import("@/app/auth/guards.server")).requireOperator();
  return (await import("./v4-attention.server")).loadV4Attention();
});
