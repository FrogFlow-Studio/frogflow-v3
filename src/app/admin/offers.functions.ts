import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/** Ограниченные предложения (модуль limited_offers): список, добавление, удаление. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("limited_offers", min);

export const offersFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { listOffers } = await import("@/core/offers/offers");
  const [offers, products] = await Promise.all([
    listOffers(ctx),
    ctx.db
      .from("products")
      .select("id, name, price, currency")
      .eq("is_active", true)
      .order("name")
      .limit(500)
      .then((r) => r.data ?? []),
  ]);
  return { offers, products };
});

export const saveOfferFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        percent: z.number().int().min(1).max(99),
        startsAt: z.string().datetime({ offset: true }).nullable(),
        endsAt: z.string().datetime({ offset: true }),
        limit: z.number().int().min(1).max(100000).nullable(),
        title: z.string().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { listOffers, saveOffers } = await import("@/core/offers/offers");
    const starts = data.startsAt ?? new Date().toISOString();
    if (Date.parse(data.endsAt) <= Date.parse(starts))
      throw new UserError("err.admin.offerEnd", "Окончание акции должно быть позже начала.");
    const current = (await listOffers(ctx)).map(({ sold: _s, left: _l, ...o }) => o);
    await saveOffers(ctx, [
      {
        id: `lo_${Date.now().toString(36)}`,
        product_id: data.productId,
        percent: data.percent,
        starts_at: starts,
        ends_at: data.endsAt,
        limit: data.limit,
        title: data.title?.trim() || undefined,
      },
      // Закончившиеся старше месяца — вон из списка, чтобы он не рос бесконечно.
      ...current.filter((o) => Date.parse(o.ends_at) > Date.now() - 30 * 86_400_000),
    ]);
    return { ok: true };
  });

export const deleteOfferFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { listOffers, saveOffers } = await import("@/core/offers/offers");
    const current = (await listOffers(ctx)).map(({ sold: _s, left: _l, ...o }) => o);
    await saveOffers(
      ctx,
      current.filter((o) => o.id !== data.id),
    );
    return { ok: true };
  });
