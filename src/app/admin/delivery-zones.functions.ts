import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";

/**
 * Админка продавца: зоны доставки.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Настройки магазина — владельцу и администратору; тариф, платежи, команда и удаление — только владельцу. */
const adminLevel = async () => (await import("@/app/auth/guards.server")).requireAdminRole("admin");

const uuid = z.string().uuid();

/* ── зоны доставки ───────────────────────────────────────────────── */

export const deliveryZonesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { data, error } = await ctx.db
    .from("delivery_zones")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw serverFailure(error.message);
  return data ?? [];
});

export const saveDeliveryZoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid.nullable(),
        name: z.string().min(1).max(80),
        price: z.number().min(0),
        isActive: z.boolean(),
        sortOrder: z.number().int(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const row = {
      name: data.name.trim(),
      price: data.price,
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };
    const { error } = data.id
      ? await ctx.db.from("delivery_zones").update(row).eq("id", data.id)
      : await ctx.db.from("delivery_zones").insert({ bot_id: ctx.tenant.id, ...row });
    if (error) throw serverFailure(error.message);
    return { ok: true };
  });

export const deleteDeliveryZoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { error } = await ctx.db.from("delivery_zones").delete().eq("id", data.id);
    if (error) throw serverFailure(error.message);
    return { ok: true };
  });
