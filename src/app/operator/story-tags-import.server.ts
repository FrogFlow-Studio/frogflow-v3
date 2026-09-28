/**
 * Теги сторис из v1 (`story_product_tags`, bot_id TEXT без RLS — ядро v2 её
 * не читает). При переключении клиента на v2 они дописываются к тегам v2
 * (mergeLegacyStoryTags); проверка переезда считает тем же слиянием, сколько
 * допишется и сколько не влезет в предел, — без записи.
 */
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import {
  mergeLegacyStoryTags,
  readStoryTagsForWrite,
  storyProductsOf,
  STORY_TAGS_MAX,
  type StoryTag,
} from "@/core/consultant/story-tags";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

type LegacyRow = {
  id: string;
  story_id: string;
  story_url: string | null;
  product_id: string | null;
  product_name: string;
  product_price_kzt: number | null;
  notes: string | null;
  created_at: string | null;
  /** Все товары истории (MIGRATION-71 v1) — колонки может не быть, select("*") её не требует. */
  products?: unknown;
};

/** Все теги v1 клиента, постранично; последний ключ сортировки уникальный. */
export async function readLegacyStoryTags(botId: string): Promise<StoryTag[]> {
  const rows = (await pageAll<LegacyRow>(
    (from, to) =>
      serviceDb()
        .from("story_product_tags")
        .select("*")
        .eq("bot_id", botId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    "теги сторис v1",
  ).catch((e: unknown) => {
    throw serverFailure(
      `Теги сторис v1 не прочитаны (${e instanceof Error ? e.message : String(e)})`,
    );
  })) as LegacyRow[];
  return rows.map((r) => {
    const tag: StoryTag = {
      id: r.id,
      story_id: r.story_id,
      story_url: r.story_url,
      product_id: r.product_id,
      product_name: r.product_name,
      price: r.product_price_kzt,
      notes: r.notes,
      created_at: r.created_at ?? new Date().toISOString(),
    };
    // Несколько товаров истории переезжают все, а не только первый.
    const products = storyProductsOf({ ...tag, products: r.products });
    return products.length > 1 ? { ...tag, products } : tag;
  });
}

export type StoryTagPlan = {
  v1: number;
  v2: number;
  add: number;
  dropped: number;
  max: number;
  merged: StoryTag[];
};

/**
 * Что сделает перенос при переключении — без записи. Сбой чтения любой из
 * сторон — ServerFailure: перенос не пишет ничего поверх непрочитанного.
 */
export async function planLegacyStoryTags(
  ctx: TenantContext,
  botId: string,
): Promise<StoryTagPlan> {
  const [legacy, own] = await Promise.all([readLegacyStoryTags(botId), readStoryTagsForWrite(ctx)]);
  const r = mergeLegacyStoryTags(own, legacy, STORY_TAGS_MAX);
  return {
    v1: legacy.length,
    v2: own.length,
    add: r.added,
    dropped: r.dropped,
    max: STORY_TAGS_MAX,
    merged: r.tags,
  };
}

export type StoryTagsImport = { added: number; dropped: number } | { error: string };

/** Итог переноса тегов одной строкой — для итога переключения у оператора. */
export function storyTagsNote(r: StoryTagsImport | undefined): string | undefined {
  if (!r) return undefined;
  if ("error" in r) return `теги сторис не перенесены: ${r.error}`;
  if (!r.added && !r.dropped) return undefined;
  return `теги сторис: перенесено ${r.added}${r.dropped ? `, не влезло в предел ${r.dropped}` : ""}`;
}
