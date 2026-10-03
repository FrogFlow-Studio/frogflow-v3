import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Ограниченные предложения (модуль limited_offers): список, добавление, удаление. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("limited_offers", min);

export const offersFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { listOffers } = await import("@/core/offers/offers");
  const { productsByIds } = await import("@/core/catalog/picker");
  const offers = await listOffers(ctx);
  // Названия товаров из предложений; выбор нового — поиском (productPickerFn).
  const products = await productsByIds(ctx, offers.map((o) => o.product_id).filter(Boolean));
  const { listAllCategories } = await import("@/core/catalog/admin");
  const categories = (await listAllCategories(ctx)).map((c) => ({ id: c.id, name: c.name }));
  return { offers, products, categories, timezone: ctx.timezone };
});

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const saveOfferFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().min(1).max(40).optional(),
        scope: z.enum(["product", "category"]),
        productId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        mode: z.enum(["percent", "price"]),
        percent: z.number().int().min(1).max(99).optional(),
        newPrice: z.number().positive().max(1e9).optional(),
        // Время магазина, как в поле datetime-local: пояс подставляет сервер.
        startsAt: localTime.nullable(),
        endsAt: localTime,
        limit: z.number().int().min(1).max(100000).nullable(),
        title: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveOfferForm } = await import("@/core/offers/admin");
    await saveOfferForm(ctx, data);
    return { ok: true };
  });

export const endOfferFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { endOfferNow } = await import("@/core/offers/admin");
    await endOfferNow(ctx, data.id);
    return { ok: true };
  });

export const announceOfferFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { announceOffer } = await import("@/core/offers/announce");
    return announceOffer(ctx, data.id);
  });

export const deleteOfferFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { updateOffers } = await import("@/core/offers/offers");
    await updateOffers(ctx, (all) => all.filter((o) => o.id !== data.id));
    return { ok: true };
  });
