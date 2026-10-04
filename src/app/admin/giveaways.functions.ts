import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GIVEAWAY_CHANNELS } from "@/core/giveaways/giveaway";

/** Розыгрыши (модуль giveaways): список, создание, правка и закрытие приёма. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("giveaways", min);

export const giveawaysFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { listGiveaways } = await import("@/core/giveaways/giveaway");
  return {
    giveaways: await listGiveaways(ctx),
    botUsername: ctx.tenant.settings.telegram?.username ?? null,
  };
});

const inputSchema = z.object({
  title: z.string().max(200),
  prize: z.string().max(500),
  channel: z.enum(GIVEAWAY_CHANNELS),
  conditions: z.string().max(3000),
  endsAt: z.string().max(40),
  winners: z.number(),
  subscribeChannel: z.string().max(60),
  excludeBlocked: z.boolean(),
  excludeStaff: z.boolean(),
});

/** Без `id` — новый розыгрыш; с `id` и `rev` — правка открытого. */
export const saveGiveawayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    inputSchema
      .extend({ id: z.string().max(16).optional(), rev: z.number().int().optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { createGiveaway, updateGiveaway } = await import("@/core/giveaways/giveaway");
    const { id, rev, ...input } = data;
    if (id === undefined) return createGiveaway(ctx, input);
    return updateGiveaway(ctx, id, rev ?? 0, input);
  });

export const closeGiveawayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().max(16) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { closeGiveaway } = await import("@/core/giveaways/giveaway");
    return closeGiveaway(ctx, data.id);
  });
