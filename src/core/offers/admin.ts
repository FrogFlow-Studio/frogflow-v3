import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { zonedLocalToUtc } from "@/core/export/csv";
import {
  OFFERS_MAX,
  listOffers,
  percentForNewPrice,
  saveOffers,
  type LimitedOffer,
} from "./offers";

/** Что продавец ввёл в форме «Акции»: время — стенные часы магазина («2026-10-12T23:59»). */
export type OfferForm = {
  id?: string;
  scope: "product" | "category";
  productId?: string;
  categoryId?: string;
  mode: "percent" | "price";
  percent?: number;
  newPrice?: number;
  startsAt: string | null;
  endsAt: string;
  limit: number | null;
  title?: string;
};

const MONTH_MS = 30 * 86_400_000;

const strip = ({ sold: _s, left: _l, ...o }: Awaited<ReturnType<typeof listOffers>>[number]) =>
  o as LimitedOffer;

/** Создание или правка акции: все проверки здесь, форма и серверная функция только передают. */
export async function saveOfferForm(
  ctx: TenantContext,
  form: OfferForm,
  now = new Date(),
): Promise<LimitedOffer> {
  const starts = form.startsAt ? zonedLocalToUtc(form.startsAt, ctx.timezone) : now.toISOString();
  const ends = zonedLocalToUtc(form.endsAt, ctx.timezone);
  if (Date.parse(ends) <= Date.parse(starts))
    throw new UserError("err.admin.offerEnd", "Окончание акции должно быть позже начала.");

  let percent = form.percent ?? 0;
  let newPrice: number | undefined;
  if (form.mode === "price") {
    if (form.scope !== "product" || !form.productId || form.newPrice == null)
      throw new UserError(
        "err.admin.offerPriceScope",
        "Новую цену можно задать только для товара, не для категории.",
      );
    const { data: product, error } = await ctx.db
      .from("products")
      .select("price")
      .eq("id", form.productId)
      .maybeSingle();
    if (error) throw serverFailure(`Акция, цена товара: ${error.message}`);
    const price = Number(product?.price) || 0;
    percent = percentForNewPrice(form.newPrice, price);
    if (!percent)
      throw new UserError(
        "err.admin.offerPriceHigher",
        "Новая цена должна быть ниже обычной цены товара.",
      );
    newPrice = form.newPrice;
  } else if (!(percent >= 1 && percent <= 99)) {
    throw new UserError("err.admin.offerPercent", "Скидка — от 1 до 99 процентов.");
  }

  const isCategory = form.scope === "category";
  if (isCategory && !form.categoryId)
    throw new UserError("err.admin.offerCategory", "Выберите категорию.");
  if (!isCategory && !form.productId)
    throw new UserError("err.admin.offerProduct", "Выберите товар.");

  const offer: LimitedOffer = {
    id: form.id ?? `lo_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    product_id: isCategory ? "" : form.productId!,
    ...(isCategory ? { category_id: form.categoryId! } : {}),
    ...(newPrice != null ? { new_price: newPrice } : {}),
    percent,
    starts_at: starts,
    ends_at: ends,
    // Проданное по категории не считается: лимит штук только у акции на товар.
    limit: isCategory ? null : form.limit,
    ...(form.title?.trim() ? { title: form.title.trim() } : {}),
  };

  // Закончившиеся старше месяца — вон из списка, чтобы он не рос бесконечно.
  const current = (await listOffers(ctx))
    .map(strip)
    .filter((o) => o.id !== form.id && Date.parse(o.ends_at) > now.getTime() - MONTH_MS);
  if (current.length >= OFFERS_MAX)
    throw new UserError(
      "err.admin.offersFull",
      "Слишком много акций: удалите прошедшие, прежде чем добавлять новые.",
    );
  await saveOffers(ctx, [offer, ...current]);
  return offer;
}

/** Досрочно закончить: идущая — до этой минуты, ещё не начавшаяся — убирается. */
export async function endOfferNow(ctx: TenantContext, id: string, now = new Date()) {
  const all = (await listOffers(ctx)).map(strip);
  const next = all.flatMap((o) => {
    if (o.id !== id) return [o];
    if (Date.parse(o.starts_at) > now.getTime()) return [];
    return Date.parse(o.ends_at) > now.getTime() ? [{ ...o, ends_at: now.toISOString() }] : [o];
  });
  await saveOffers(ctx, next);
}
