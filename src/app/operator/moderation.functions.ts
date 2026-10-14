import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: модерация сообщества и маркетплейса.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const impl = () => import("./operator.server");

const botId = z.string().uuid();

/** Сообщество авторов (core/community): оператор скрывает или блокирует автора. */
export const communityModFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const t = await requireTenant({ by: "id", value: data.botId });
    return (await import("@/core/community/settings.server")).communityView({ tenant: t });
  });

/** Площадка FrogFlow (core/marketplace): оператор скрывает магазин с площадки. */
export const marketplaceModFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const t = await requireTenant({ by: "id", value: data.botId });
    return (await import("@/core/marketplace/settings.server")).marketplaceView({ tenant: t });
  });

export const setMarketplaceHiddenFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, hidden: z.boolean(), reason: z.string().max(300) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setMarketplaceHidden(data.botId, data.hidden, data.reason, await actor());
    return { ok: true };
  });

/**
 * Одобрить магазин для площадки или снять одобрение. `consent` — как получено согласие
 * продавца; непустое — оператор заодно включает показ за продавца.
 */
export const setMarketplaceApprovedFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, approved: z.boolean(), consent: z.string().max(300) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (
      await impl()
    ).setMarketplaceApproved(data.botId, data.approved, data.consent, await actor());
    return { ok: true };
  });

export const setCommunityModFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        status: z.enum(["hidden", "blocked"]).nullable(),
        reason: z.string().max(300),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (
      await import("@/core/community/settings.server")
    ).setCommunityMod(data.botId, data.status, data.reason);
    const { logEvent } = await import("./operator.server");
    await logEvent(
      data.botId,
      "meta",
      { action: "community", status: data.status, reason: data.reason },
      await actor(),
    );
    return { ok: true };
  });

/** Жалобы сообщества: список и решение «скрыть»/«отклонить» (core/community/moderation). */
export const communityReportsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ offset: z.number().int().min(0).max(100_000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { orSoon } = await import("@/core/community/not-ready");
    return orSoon(async () =>
      (await import("@/core/community/moderation.server")).listOpenReports(data.offset),
    );
  });

export const resolveCommunityReportFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["hide", "dismiss", "restore"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await import("@/core/community/moderation.server")).resolveReport(data.id, data.action);
    return { ok: true };
  });

/** Жалобы на магазины площадки (core/marketplace/report): список, «скрыть с площадки» или «отклонить». */
export const marketReportsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ offset: z.number().int().min(0).max(100_000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./market-reports.server")).marketReportsView(data.offset);
  });

export const resolveMarketReportFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["hide", "dismiss"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./market-reports.server")).resolveMarketReport(
      data.id,
      data.action,
      await actor(),
    );
  });

/** Аналитика площадки за 30 дней (В20); null — таблицы ещё нет. */
export const marketOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("@/core/marketplace/analytics.server")).marketOverview();
});
