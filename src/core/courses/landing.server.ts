import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { imageUrl } from "@/core/catalog/catalog";
import { pageAll } from "@/core/db/page";
import { readSetting } from "./db.server";
import { cleanLanding, cleanShort, landingKey, parseLanding, type CourseLanding } from "./landing";

const PREFIX = landingKey("");

/** Все страницы курсов магазина: [id товара, запись]. Сбой чтения — сбой, не «нет». */
async function allLandings(ctx: TenantContext): Promise<Array<[string, CourseLanding]>> {
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${PREFIX}%`)
        .order("key")
        .range(from, to),
    "страницы курсов",
  );
  return rows
    .filter((r) => r.key.startsWith(PREFIX))
    .map((r) => [r.key.slice(PREFIX.length), parseLanding(r.value, ctx.tenant.id)]);
}

/**
 * Товар по короткой ссылке (/s/<магазин>/p/<short>): только включённая
 * страница курса. null — такой ссылки нет.
 */
export async function productByShort(ctx: TenantContext, short: string): Promise<string | null> {
  const want = cleanShort(short);
  if (!want) return null;
  const hit = (await allLandings(ctx)).find(([, l]) => l.on && l.short === want);
  return hit ? hit[0] : null;
}

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
  if (landing.short && !clean.short)
    throw new UserError(
      "err.course.shortBad",
      "Короткая ссылка — латиница, цифры и дефис, от 2 до 40 знаков.",
    );
  if (clean.short) {
    const taken = (await allLandings(ctx)).some(
      ([pid, l]) => pid !== productId && l.short === clean.short,
    );
    if (taken)
      throw new UserError("err.course.shortTaken", "Эта короткая ссылка уже у другого курса.");
  }
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
