import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/**
 * Подборки площадки (Л3): создаёт и правит только оператор. Продавцы и покупатели подборки
 * только читают (главная площадки). Таблицы нет (миграция 22-2 не применена) — `ready: false`.
 */
export const marketCollectionsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { operatorCollectionsView } = await import("@/core/marketplace/collections.server");
  const { MarketplaceNotReady } = await import("@/core/marketplace/not-ready");
  try {
    return { ready: true as const, collections: await operatorCollectionsView() };
  } catch (e) {
    if (e instanceof MarketplaceNotReady) return { ready: false as const };
    throw e;
  }
});

const itemInput = z.object({ shopId: z.string().uuid(), productId: z.string().uuid() });

export const saveMarketCollectionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.record(z.string().max(80)),
        items: z.array(itemInput).max(24),
        published: z.boolean(),
        position: z.number().int().min(0).max(10_000),
        rev: z.number().int().min(1).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("@/core/marketplace/collections.server")).saveCollection(data);
  });

export const deleteMarketCollectionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await import("@/core/marketplace/collections.server")).deleteCollection(data.id);
    return { ok: true as const };
  });

/** Поиск товаров площадки, чтобы положить их в подборку: тот же поиск, что у покупателей. */
export const searchCollectionItemsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { searchMarketItems } = await import("@/core/marketplace/items.server");
    const r = await searchMarketItems({ search: data.q });
    return r.items;
  });
