import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Бесплатная доставка от суммы (core/fulfillment/free-delivery): читают все сотрудники, меняет владелец. */
export const freeDeliveryFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  const { loadFreeDeliveryRules } = await import("@/core/fulfillment/free-delivery");
  const { activeDeliveryZones } = await import("@/core/fulfillment/fulfillment");
  const { shopCurrency } = await import("@/core/discounts/discounts");
  const rules = await loadFreeDeliveryRules(ctx);
  return {
    general: rules.general,
    zones: (await activeDeliveryZones(ctx)).map((z) => ({
      id: z.id,
      name: z.name,
      from: rules.zones[z.id.toLowerCase()] ?? 0,
    })),
    currency: await shopCurrency(ctx),
  };
});

export const saveFreeDeliveryFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        general: z.number().min(0).max(100_000_000),
        zones: z.record(z.string().uuid(), z.number().min(0).max(100_000_000)),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("owner");
    const { saveFreeDeliveryRules } = await import("@/core/fulfillment/free-delivery");
    const { activeDeliveryZones } = await import("@/core/fulfillment/fulfillment");
    const zoneIds = (await activeDeliveryZones(ctx)).map((z) => z.id);
    await saveFreeDeliveryRules(ctx, { general: data.general, zones: data.zones }, zoneIds);
    return { ok: true };
  });
