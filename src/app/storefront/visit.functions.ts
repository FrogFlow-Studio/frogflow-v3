import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isWebSource } from "@/core/storefront/web-source";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { VISIT_STAGES } from "@/core/analytics/visits";

/**
 * Счётчик визитов витрины (У1). Браузер шлёт раз за сессию «зашёл» и раз «посмотрел товар»
 * с меткой из ссылки и адресом, откуда пришёл; сервер превращает их в группу источника
 * (core/analytics/visits) и прибавляет единицу в счётчик. Адрес и браузер посетителя не
 * сохраняются: в базу идёт группа, день и этап. Клиент прежней платформы и закрытая витрина —
 * 404, как у любой страницы витрины (storefrontOpen проверяет servedByV2).
 */
export const trackStoreVisitFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        stage: z.enum(VISIT_STAGES),
        source: z.string().max(64).refine(isWebSource).nullable().optional(),
        referrer: z.string().max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !storefrontOpen(t, "catalog")) throw notFound();
    const ctx = tenantContext(t);
    // Каждый вызов — запись в базу: без счёта анонимный вызов накрутил бы визиты.
    const { clientIp } = await import("@/app/auth/login-guard.server");
    const { takeWeb } = await import("@/core/storefront/checkout-guard");
    if (!(await takeWeb(ctx, "visit", clientIp() ?? "unknown"))) return { counted: false };
    const { visitSource } = await import("@/core/analytics/visits");
    let ownHost: string | null = null;
    try {
      ownHost = new URL(ctx.appUrl).hostname;
    } catch {
      /* адрес платформы не разобрать — площадка не отличается от «другого сайта» */
    }
    const source = visitSource({
      webSource: data.source ?? null,
      referrer: data.referrer ?? null,
      ownHost,
    });
    const { recordVisit } = await import("@/core/analytics/visits.server");
    return recordVisit(ctx, { source, stage: data.stage });
  });
