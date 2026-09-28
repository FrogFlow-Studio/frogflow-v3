import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings } from "@/core/settings/settings";

/**
 * Какие юр. документы покупатель принимает при оформлении на сайте: те, что
 * опубликованы (модуль legal_docs и непустой текст). Нет ни одного —
 * галочки нет, как раньше.
 */
export async function legalConsentNeeded(
  ctx: TenantContext,
): Promise<{ offer: boolean; privacy: boolean }> {
  if (!ctx.tenant.modules.legal_docs) return { offer: false, privacy: false };
  const s = await getSettings(ctx, ["legal_offer", "legal_privacy"]);
  return { offer: Boolean(s.legal_offer?.trim()), privacy: Boolean(s.legal_privacy?.trim()) };
}
