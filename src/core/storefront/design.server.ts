import { patchTenantSettings } from "@/core/tenant/resolve.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { parseDesign, type StoreDesign } from "./design";

export const designView = (ctx: Pick<TenantContext, "tenant">): StoreDesign =>
  parseDesign(ctx.tenant.settings.storefront_design);

/** Сохранить оформление; лишнее отбрасывается разбором, ключи клиента не затираются. */
export async function saveDesign(ctx: TenantContext, input: unknown): Promise<StoreDesign> {
  const d = parseDesign(input);
  await patchTenantSettings(ctx.tenant.id, {
    // blocks — массив: patchTenantSettings заменяет его целиком, а не сливает.
    storefront_design: { theme: d.theme, cover: d.cover, blocks: d.blocks, photo: d.photo },
  });
  return d;
}
