import { listInboxPage } from "@/core/inbox/page";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Все диалоги магазина одним списком — для проверок живой базы (страницы здесь не нужны). */
export async function allConversations(ctx: TenantContext) {
  const { items } = await listInboxPage(ctx, {
    filter: { status: "all", who: "all", channel: "all" },
    me: "",
    limit: 100_000,
  });
  return items;
}
