import { UserError } from "@/core/i18n/user-error";
import { patchTenantSettings, requireTenant } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import {
  marketplaceCategory,
  marketplaceCity,
  marketplaceState,
  type MarketplaceState,
} from "./consent";

export type MarketplaceView = {
  state: MarketplaceState;
  listed: boolean;
  hidden: boolean;
  hiddenReason: string;
  /** Подписи продавца в каталоге; пусто — берётся ниша магазина. */
  category: string;
  city: string;
  /** Ниша магазина — подпись по умолчанию. */
  defaultCategory: string;
};

export function marketplaceView(ctx: Pick<TenantContext, "tenant">): MarketplaceView {
  const t = ctx.tenant;
  const m = t.settings.marketplace;
  return {
    state: marketplaceState(t),
    listed: m?.listed === true,
    hidden: m?.hidden === true,
    hiddenReason: m?.hidden_reason ?? "",
    category: m?.category ?? "",
    city: marketplaceCity(t),
    defaultCategory: marketplaceCategory({
      ...t,
      settings: { ...t.settings, marketplace: undefined },
    }),
  };
}

const label = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 60) : "";

/**
 * Владелец включает или выключает показ на площадке и подписывает категорию и
 * город. Решение оператора (`hidden`) и одобрение (`approved`) не трогает.
 */
export async function saveMarketplaceListing(
  ctx: TenantContext,
  input: { listed: boolean; category: string; city: string },
): Promise<MarketplaceView> {
  if (!servedByV2(ctx.tenant)) {
    throw new UserError(
      "err.marketplace.oldPlatform",
      "Площадка доступна магазинам на новой платформе.",
    );
  }
  const category = label(input.category);
  const city = label(input.city);
  await patchTenantSettings(ctx.tenant.id, {
    marketplace: { listed: input.listed, category, city },
  });
  const next: Tenant = {
    ...ctx.tenant,
    settings: {
      ...ctx.tenant.settings,
      marketplace: {
        ...ctx.tenant.settings.marketplace,
        listed: input.listed || undefined,
        category: category || undefined,
        city: city || undefined,
      },
    },
  };
  return marketplaceView({ tenant: next });
}

/** Оператор скрывает магазин с площадки или возвращает (в журнал клиента пишет слой оператора). */
export async function setMarketplaceHidden(
  botId: string,
  hidden: boolean,
  reason: string,
): Promise<MarketplaceView> {
  const why = reason.replace(/\s+/g, " ").trim().slice(0, 300);
  await patchTenantSettings(botId, {
    marketplace: { hidden, hidden_reason: hidden ? why : "" },
  });
  return marketplaceView({ tenant: await requireTenant({ by: "id", value: botId }) });
}
