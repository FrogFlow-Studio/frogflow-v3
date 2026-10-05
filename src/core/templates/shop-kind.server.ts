/**
 * Применение шаблона магазина по типу (Р2). Только в пустой магазин: ни
 * товаров, ни категорий. Настоящие категории создаются через createCategory,
 * тексты «О магазине» пишутся в bots.settings.storefront_about через
 * patchTenantSettings и только в пустые поля (то, что продавец уже написал,
 * не затирается), выдача и оплата — в app_settings.
 *
 * Два одновременных применения (двойной клик, две вкладки): короткая
 * блокировка в app_settings берётся условной записью, а пустота магазина
 * проверяется уже после неё — иначе проигравший успел бы проверить «пусто»
 * до того, как победитель создал категории, и положил их второй раз.
 */
import { createCategory, deleteCategory } from "@/core/catalog/admin";
import { UserError } from "@/core/i18n/user-error";
import { getSettingsStrict, setSetting, updateSettingAtomic } from "@/core/settings/settings";
import { patchTenantSettings, type TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { templateAvailable } from "./apply.server";
import { templateLang } from "./niches";
import { SHOP_KIND_TEMPLATES, type ShopKind } from "./shop-kinds";

export const KIND_LOCK_KEY = "shop_kind_lock";
const LOCK_MS = 60_000;

const notEmpty = () =>
  new UserError(
    "err.shopKind.notEmpty",
    "Шаблон ставится только в пустой магазин — у вас уже есть товары или категории.",
  );

export async function applyShopKind(
  ctx: TenantContext,
  kind: ShopKind,
  now = Date.now(),
): Promise<{ categories: number }> {
  const tpl = SHOP_KIND_TEMPLATES[kind];
  const lock = await updateSettingAtomic(ctx, KIND_LOCK_KEY, (raw) =>
    raw && now - Date.parse(raw) < LOCK_MS ? null : new Date(now).toISOString(),
  );
  if (lock === "skipped")
    throw new UserError("err.shopKind.busy", "Шаблон уже применяется — подождите минуту.");
  if (lock === "failed") throw serverFailure("Шаблон магазина: не удалось взять блокировку");
  const created: string[] = [];
  try {
    if (!(await templateAvailable(ctx))) throw notEmpty();
    const lang = templateLang(ctx.tenant.settings.default_locale);
    for (const [i, c] of tpl.categories.entries())
      created.push(await createCategory(ctx, { name: c[lang], parentId: null, sortOrder: i }));
    const had = ctx.tenant.settings.storefront_about ?? {};
    const about: Record<string, string> = {};
    for (const k of ["description", "delivery", "payment"] as const)
      if (!had[k]?.trim()) about[k] = tpl.about[k][lang];
    if (Object.keys(about).length)
      await patchTenantSettings(ctx.tenant.id, { storefront_about: about });
    // Выдача и оплата: что продавец уже выбрал сам, не меняем.
    const mine = await getSettingsStrict(ctx, [
      "fulfillment_pickup_enabled",
      "fulfillment_delivery_enabled",
      "payment_mode",
    ]);
    const want: Record<string, string> = {
      fulfillment_pickup_enabled: tpl.settings.pickup ? "true" : "false",
      fulfillment_delivery_enabled: tpl.settings.delivery ? "true" : "false",
      payment_mode: tpl.settings.paymentMode,
    };
    for (const [key, value] of Object.entries(want))
      if (!mine[key]?.trim()) await setSetting(ctx, key, value);
    return { categories: created.length };
  } catch (e) {
    // Сбой на середине: убираем созданные категории, чтобы шаблон можно было повторить.
    for (const id of created)
      await deleteCategory(ctx, id).catch((e2) => console.error("[shop-kind] откат:", e2));
    throw e;
  } finally {
    await setSetting(ctx, KIND_LOCK_KEY, "").catch(() => undefined);
  }
}
