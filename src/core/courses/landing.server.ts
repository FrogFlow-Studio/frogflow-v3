import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { imageUrl } from "@/core/catalog/catalog";
import { readSetting } from "./db.server";
import { cleanLanding, landingKey, parseLanding, type CourseLanding } from "./landing";

/** Страница курса в админке: прочитать как есть (выключенная тоже). */
export async function getLanding(ctx: TenantContext, productId: string): Promise<CourseLanding> {
  return parseLanding(await readSetting(ctx, landingKey(productId)), ctx.tenant.id);
}

/**
 * Сохранить страницу курса. Только для цифрового товара этого магазина (права
 * арендатора не дадут увидеть чужой). Запись — целиком, условно по метке
 * `updated_at` (`updateSettingStamped`): страницу пишет только эта форма.
 */
export async function saveLanding(
  ctx: TenantContext,
  productId: string,
  landing: CourseLanding,
): Promise<CourseLanding> {
  const { data: product, error } = await ctx.db
    .from("products")
    .select("id, fulfillment_kind")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw serverFailure(`Товар не прочитан: ${error.message}`);
  if (!product) throw new UserError("err.course.noProduct", "Товар не найден.");
  if (product.fulfillment_kind === "physical")
    throw new UserError(
      "err.course.physical",
      "Курс можно сделать только из цифрового товара, не из физического.",
    );
  const clean = cleanLanding(landing as unknown as Record<string, unknown>, ctx.tenant.id);
  const r = await updateSettingStamped(ctx, landingKey(productId), () => JSON.stringify(clean));
  if (r !== "written")
    throw new UserError(
      "err.settings.saveFailed",
      "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
    );
  return clean;
}

/** Страница курса для витрины: фото — публичными адресами. */
export type StoreLanding = Omit<CourseLanding, "on" | "authors" | "works"> & {
  authors: Array<{ photo: string | null; name: string; text: string }>;
  works: string[];
};

/** null — страницы нет или она выключена: товар показывается как раньше. */
export async function storeLanding(
  ctx: TenantContext,
  productId: string,
): Promise<StoreLanding | null> {
  const l = await getLanding(ctx, productId);
  if (!l.on) return null;
  const { on: _on, ...rest } = l;
  return {
    ...rest,
    authors: l.authors.map((a) => ({ ...a, photo: a.photo ? imageUrl(ctx, a.photo) : null })),
    works: l.works.map((k) => imageUrl(ctx, k)),
  };
}
