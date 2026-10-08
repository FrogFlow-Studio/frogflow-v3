import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Админка продавца: аналитика продаж.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

/** Разделы бухгалтера (guards.server requireAdminFinance): ответ без контактов, если это он. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();

/* ── аналитика ───────────────────────────────────────────────────── */

export const analyticsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx, accountant } = await finance();
    const now = new Date();
    const from = new Date(now.getTime() - data.days * 86_400_000);
    const funnels = await import("@/core/analytics/funnel.server");
    const { accountantView } = await import("@/core/analytics/role-view");
    const [a, funnel, sources, cohorts, customers, speed, sales, giftsBundles, promote, visits] =
      await Promise.all([
        (await import("@/core/analytics/analytics")).analytics(ctx, data.days),
        funnels.buyerFunnel(ctx, from, now),
        accountant ? Promise.resolve([]) : funnels.sourceFunnel(ctx, from, now),
        (await import("@/core/analytics/cohorts.server")).cohorts(ctx, now),
        (await import("@/core/analytics/customers.server")).customersBlock(ctx, data.days, now),
        (await import("@/core/analytics/speed.server")).speedStats(ctx, from, now),
        (await import("@/core/analytics/sales.server")).saleResults(ctx, now),
        (await import("@/core/analytics/bundles.server")).bundleGiftResults(ctx, data.days, now),
        // «Что продвигать» (У4): совет продавцу, бухгалтеру не показывается; сбой чтения — «не удалось загрузить».
        accountant
          ? null
          : import("@/core/analytics/promote.server")
              .then((m) => m.loadPromoteHints(ctx, now))
              .catch((e): "failed" => {
                console.error(
                  `[admin:${ctx.tenant.id}] что продвигать`,
                  e instanceof Error ? e.message : e,
                );
                return "failed";
              }),
        // Визиты витрины (У1): таблицы может не быть (null — «нет данных»), сбой чтения — «не удалось загрузить»; бухгалтеру не нужны.
        accountant
          ? null
          : import("@/core/analytics/visits.server")
              .then((m) => m.loadVisits(ctx, from, now))
              .catch((e): "failed" => {
                console.error(
                  `[admin:${ctx.tenant.id}] визиты`,
                  e instanceof Error ? e.message : e,
                );
                return "failed";
              }),
      ]);
    const { storefrontOpen } = await import("@/core/storefront/access");
    const { storefrontBase } = await import("@/core/tenant/custom-domain");
    /** Куда ведут ссылки с меткой (core/analytics/source-links). */
    const links = {
      bot: ctx.tenant.telegramTokenEnc ? (ctx.tenant.settings.telegram?.username ?? null) : null,
      store:
        ctx.tenant.settings.slug && storefrontOpen(ctx.tenant, "catalog")
          ? storefrontBase(ctx.tenant, ctx.appUrl)
          : null,
    };
    const sourceRows: import("@/core/analytics/visits").SourceRowWithVisits[] =
      visits && visits !== "failed"
        ? (await import("@/core/analytics/visits")).attachVisits(sources, visits)
        : sources;
    return accountantView(
      {
        ...a,
        funnel,
        sources: sourceRows,
        visits: visits && visits !== "failed" ? visits.total : visits,
        links,
        cohorts,
        customers,
        speed,
        sales,
        giftsBundles,
        promote,
        timezone: ctx.timezone,
      },
      accountant,
    );
  });
