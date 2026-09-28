import type { Tenant } from "@/core/tenant/types";

/**
 * Консультант работает «по прайсу» (BOVI): флаг оператора
 * `settings.consultant_pricelist.enabled`, а не вертикаль — вертикаль v1
 * «consultant_bovi_v2» жила в окружении деплоя, в базе её нет.
 */
export function pricelistMode(tenant: Pick<Tenant, "settings">): boolean {
  return tenant.settings.consultant_pricelist?.enabled === true;
}

/** Рабочие часы по умолчанию — как у BOVI в v1: с 10 до 21 по поясу магазина. */
export const DEFAULT_HOURS = { open: 10, close: 21 } as const;
