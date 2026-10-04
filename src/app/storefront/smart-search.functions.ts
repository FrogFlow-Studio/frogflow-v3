import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

/**
 * Умный поиск на витрине (core/search/smart.server): фолбэк, когда обычный поиск
 * ничего не нашёл. Тот же переключатель продавца, тариф, дневной предел запросов и
 * расходов в долларах, что и у бота; личный кулдаун — по сессии браузера, сверху
 * потолок на адрес. Клиент прежней платформы, архив и витрина без каталога — «не найден».
 */
export const SMART_SEARCH_WEB_MAX = 12;

export const storeSmartSearchFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        slug: z.string().regex(SHOP_SLUG_RE),
        q: z.string().trim().min(2).max(80),
        session: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { storefrontOpen } = await import("@/core/storefront/access");
    const { servedByV2 } = await import("@/core/tenant/directory");
    const t = await resolveTenant({ by: "slug", value: data.slug });
    if (!t || !servedByV2(t) || !storefrontOpen(t, "catalog")) throw notFound();
    const ctx = tenantContext(t);
    const none = { state: "none" as const, items: [] };
    const { smartSearchEnabled, consumeWebQuota, smartSearchProductIds } =
      await import("@/core/search/smart.server");
    if (!(await smartSearchEnabled(ctx))) return { state: "off" as const, items: [] };
    // Платный вызов — только когда обычный поиск пуст (проверяем здесь, а не верим клиенту).
    const { storeCatalogPage, storeProductsByIds } = await import("@/core/storefront/catalog");
    if ((await storeCatalogPage(ctx, { q: data.q, limit: 1 })).items.length > 0) return none;
    const { clientIp } = await import("@/app/auth/login-guard.server");
    if (!(await consumeWebQuota(ctx, data.session, clientIp())))
      return { state: "busy" as const, items: [] };
    const ids = await smartSearchProductIds(ctx, data.q);
    if (!ids?.length) return none;
    return {
      state: "ok" as const,
      items: await storeProductsByIds(ctx, ids.slice(0, SMART_SEARCH_WEB_MAX)),
    };
  });
