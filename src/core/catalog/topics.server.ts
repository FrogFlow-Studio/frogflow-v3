import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { topicSuggestions } from "./topics";

/**
 * Темы, уже заведённые в магазине (подсказки в форме товара и для массового
 * назначения), — чтобы не плодить «1 сентября» и «1-е сентября». Читаются
 * только товары с меткой темы, постранично и без обрезки.
 */
export async function listShopTopics(ctx: TenantContext): Promise<string[]> {
  const rows = await pageAll<{ keywords: string | null }>(
    (from, to) =>
      ctx.db
        .from("products")
        .select("id, keywords")
        .ilike("keywords", "%#тема:%")
        .order("id")
        .range(from, to),
    "Темы товаров",
  );
  return topicSuggestions(rows.map((r) => r.keywords));
}
