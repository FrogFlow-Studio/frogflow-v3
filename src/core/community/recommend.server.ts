import { UserError } from "@/core/i18n/user-error";
import { patchTenantSettings, tenantDirectory } from "@/core/tenant/resolve.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { communityProfile, shownInCommunity, takesPartInCommunity } from "./profile";
import { RECOMMEND_MAX, cleanRecommend, mutualRecommendations } from "./recommend";

export type RecommendView = {
  max: number;
  /** Кому я рекомендую (только те, кто сейчас в сообществе). */
  chosen: string[];
  /** Кого можно выбрать: авторы в сообществе, кроме меня. */
  candidates: { id: string; name: string }[];
  /** С кем рекомендация взаимная и действует сейчас. */
  mutual: string[];
};

export async function recommendView(ctx: Pick<TenantContext, "tenant">): Promise<RecommendView> {
  const all = await tenantDirectory();
  const me = ctx.tenant;
  const candidates = all
    .filter((t) => t.id !== me.id && shownInCommunity(t))
    .map((t) => ({ id: t.id, name: communityProfile(t.settings).name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const ids = new Set(candidates.map((c) => c.id));
  return {
    max: RECOMMEND_MAX,
    chosen: cleanRecommend(me.settings.community_recommend, me.id).filter((id) => ids.has(id)),
    candidates,
    mutual: mutualRecommendations(me, all).map((t) => t.id),
  };
}

/** Автор сохраняет, каких магазинов рекомендует. Неизвестные и скрытые из списка отбрасываются. */
export async function saveRecommend(ctx: TenantContext, ids: unknown): Promise<RecommendView> {
  if (!takesPartInCommunity(ctx.tenant)) {
    throw new UserError(
      "err.community.notJoined",
      "Сначала включите «Показывать меня в сообществе» в настройках.",
    );
  }
  const list = cleanRecommend(ids, ctx.tenant.id);
  if (Array.isArray(ids) && ids.length > RECOMMEND_MAX) {
    throw new UserError(
      "err.community.recommendMax",
      "Рекомендовать можно не больше пяти магазинов.",
    );
  }
  const known = new Set((await tenantDirectory()).filter(shownInCommunity).map((t) => t.id));
  const clean = list.filter((id) => known.has(id));
  await patchTenantSettings(ctx.tenant.id, { community_recommend: clean });
  const next = { ...ctx.tenant, settings: { ...ctx.tenant.settings, community_recommend: clean } };
  return recommendView({ tenant: next });
}
