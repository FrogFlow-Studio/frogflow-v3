import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { COMMUNITY_LIMITS } from "@/core/community/profile";

/** Профиль автора в сообществе (core/community): читают все сотрудники, меняет владелец. */
export const communityProfileFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("@/core/community/settings.server")).communityView(ctx);
});

export const saveCommunityProfileFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        name: z.string().max(COMMUNITY_LIMITS.name),
        niche: z.string().max(COMMUNITY_LIMITS.niche),
        city: z.string().max(COMMUNITY_LIMITS.city),
        about: z.string().max(COMMUNITY_LIMITS.about),
        links: z.array(z.string().max(COMMUNITY_LIMITS.link)).max(COMMUNITY_LIMITS.links),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("owner");
    return (await import("@/core/community/settings.server")).saveCommunityProfile(ctx, data);
  });
