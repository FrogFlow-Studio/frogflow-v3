import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";
import { GIVEAWAY_CHANNELS } from "@/core/giveaways/giveaway";

/** Розыгрыши (модуль giveaways): список, создание, правка и закрытие приёма. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("giveaways", min);

export const giveawaysFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { listGiveaways } = await import("@/core/giveaways/giveaway");
  const { instagramAccounts } = ctx.tenant.modules.instagram
    ? await import("@/channels/zernio/automations.server")
    : { instagramAccounts: () => [] };
  return {
    giveaways: await listGiveaways(ctx),
    botUsername: ctx.tenant.settings.telegram?.username ?? null,
    igAccounts: instagramAccounts(ctx).map((a) => ({ id: a.id, name: a.name })),
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
  igAccountId: z.string().max(100).default(""),
  igPostId: z.string().max(100).default(""),
  igPostLabel: z.string().max(200).default(""),
  igKeyword: z.string().max(100).default(""),
  igReply: z.string().max(2000).default(""),
  excludeBlocked: z.boolean(),
  excludeStaff: z.boolean(),
  prizePromoPercent: z.number().default(0),
  promoDays: z.number().default(30),
  consolationPercent: z.number().default(0),
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
    if (input.channel !== "telegram") {
      // Instagram — модуль «instagram» и аккаунт этого магазина (не чужой id из запроса).
      const { ownsZernioAccount } = await import("@/channels/zernio/automations.server");
      if (!ctx.tenant.modules.instagram || !ownsZernioAccount(ctx, input.igAccountId))
        throw new UserError(
          "err.giveaway.igAccount",
          "Аккаунт Instagram не подключён к вашему магазину.",
        );
    }
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

/** Итоги розыгрыша: участники, новые покупатели, подписка, заказы за 14 дней. Только чтение. */
export const giveawayResultsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string().max(16) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin();
    const { giveawayResults } = await import("@/core/giveaways/results");
    return giveawayResults(ctx, data.id);
  });

/** Подписку на канал проверяет бот магазина; без Telegram проверять нечем — розыгрыш с подпиской не выбирается. */
async function memberCheck(ctx: Awaited<ReturnType<typeof moduleAdmin>>) {
  const { adminTelegramApi } = await import("@/channels/telegram/notify");
  const { membership } = await import("@/channels/telegram/giveaway");
  const api = adminTelegramApi(ctx);
  return api ? membership(api) : null;
}

/** Выбрать победителей. Повтор возвращает уже выбранных. */
export const drawGiveawayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().max(16) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { drawWinners } = await import("@/core/giveaways/draw");
    return (await drawWinners(ctx, data.id, await memberCheck(ctx))).giveaway;
  });

/** Заменить победителя; причина обязательна и остаётся в журнале розыгрыша. */
export const rerollGiveawayWinnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ id: z.string().max(16), userKey: z.string().max(80), reason: z.string().max(500) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { rerollWinner } = await import("@/core/giveaways/draw");
    return (await rerollWinner(ctx, data.id, data.userKey, data.reason, await memberCheck(ctx)))
      .giveaway;
  });
