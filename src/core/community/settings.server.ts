import { UserError } from "@/core/i18n/user-error";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  COMMUNITY_LIMITS,
  cleanProfile,
  communityMod,
  communityProfile,
  communityState,
  type CommunityMod,
  type CommunityProfile,
  type CommunityState,
} from "./profile";

export type CommunityView = {
  profile: CommunityProfile;
  state: CommunityState;
  mod: CommunityMod | null;
};

export function communityView(ctx: Pick<TenantContext, "tenant">): CommunityView {
  const t = ctx.tenant;
  return {
    profile: communityProfile(t.settings),
    state: communityState(t),
    mod: communityMod(t.settings),
  };
}

/**
 * Автор сохраняет свой профиль. Включить без названия нельзя; решение
 * оператора (`community_mod`) лежит в другом ключе и профилем не затирается.
 */
export async function saveCommunityProfile(
  ctx: TenantContext,
  input: unknown,
): Promise<CommunityView> {
  if (!servedByV2(ctx.tenant)) {
    throw new UserError(
      "err.community.oldPlatform",
      "Сообщество доступно магазинам на новой платформе.",
    );
  }
  const p = cleanProfile(input);
  if (p.enabled && !p.name) {
    throw new UserError(
      "err.community.noName",
      "Чтобы показываться в сообществе, укажите название.",
    );
  }
  await patchTenantSettings(ctx.tenant.id, { community: p });
  const next = { ...ctx.tenant, settings: { ...ctx.tenant.settings, community: p } };
  return communityView({ tenant: next });
}

/** Оператор скрывает или блокирует автора; `null` снимает решение. */
export async function setCommunityMod(
  botId: string,
  status: "hidden" | "blocked" | null,
  reason: string,
): Promise<void> {
  const mod = status
    ? {
        status,
        reason: reason.replace(/\s+/g, " ").trim().slice(0, COMMUNITY_LIMITS.reason),
        at: new Date().toISOString(),
      }
    : null;
  await patchTenantSettings(botId, { community_mod: mod });
}
