import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Теги товаров на сторис для консультанта: покупатель отвечает на сторис
 * «сколько стоит?», Zernio присылает id сторис или ссылку на медиа, и
 * консультант знает, о каком товаре речь. В v1 теги лежали в
 * `story_product_tags` (bot_id TEXT, без RLS) — v2 держит их в
 * `app_settings.consultant_story_tags` арендатора; при переезде оператор
 * копирует старые строки (operator.server.ts).
 */
export const STORY_TAGS_KEY = "consultant_story_tags";
export const STORY_TAGS_MAX = 200;

export type StoryTag = {
  id: string;
  story_id: string;
  story_url: string | null;
  product_id: string | null;
  product_name: string;
  price: number | null;
  notes: string | null;
  created_at: string;
};

export type InstagramMediaInfo = {
  shortcode: string | null;
  cleanUrl: string | null;
  type: "reel" | "post" | "story" | "unknown";
};

/** Ссылка Instagram, короткий код или id → канонический адрес и код (перенос из v1). */
export function extractInstagramMediaInfo(input: string | null | undefined): InstagramMediaInfo {
  if (!input) return { shortcode: null, cleanUrl: null, type: "unknown" };
  const s = input.trim();
  const reel = s.match(/(?:instagram\.com|instagr\.am)\/(?:reel|reels)\/([A-Za-z0-9_-]+)/i);
  if (reel)
    return {
      shortcode: reel[1]!,
      cleanUrl: `https://www.instagram.com/reel/${reel[1]}/`,
      type: "reel",
    };
  const post = s.match(/(?:instagram\.com|instagr\.am)\/p\/([A-Za-z0-9_-]+)/i);
  if (post)
    return {
      shortcode: post[1]!,
      cleanUrl: `https://www.instagram.com/p/${post[1]}/`,
      type: "post",
    };
  const story = s.match(/(?:instagram\.com|instagr\.am)\/stories\/[^/]+\/(\d+)/i);
  if (story)
    return {
      shortcode: story[1]!,
      cleanUrl: `https://www.instagram.com/stories/${story[1]}/`,
      type: "story",
    };
  if (/^[A-Za-z0-9_-]{5,30}$/.test(s) && !s.includes("/") && !s.includes("."))
    return { shortcode: s, cleanUrl: `https://www.instagram.com/reel/${s}/`, type: "reel" };
  return { shortcode: null, cleanUrl: s, type: "unknown" };
}

/**
 * Поиск тега по тому, что прислал Zernio: точный id, точная ссылка, код из
 * ссылки, число внутри id, имя файла медиа — в порядке убывания надёжности.
 */
export function findStoryTag(
  tags: readonly StoryTag[],
  storyId: string | null | undefined,
  url: string | null | undefined,
): StoryTag | null {
  if (!tags.length) return null;
  const id = (storyId ?? "").trim();
  if (id) {
    const byId = tags.find((t) => t.story_id === id);
    if (byId) return byId;
    const info = extractInstagramMediaInfo(id);
    if (info.shortcode) {
      const hit = tags.find(
        (t) => t.story_id === info.shortcode || (t.story_url ?? "").includes(info.shortcode!),
      );
      if (hit) return hit;
    }
    const digits = id.match(/\d{6,}/g) ?? [];
    for (const d of digits) {
      const hit = tags.find((t) => t.story_id === d || (t.story_url ?? "").includes(d));
      if (hit) return hit;
    }
  }
  const u = (url ?? "").trim();
  if (u) {
    const byUrl = tags.find((t) => t.story_url === u);
    if (byUrl) return byUrl;
    const info = extractInstagramMediaInfo(u);
    if (info.shortcode) {
      const hit = tags.find(
        (t) => t.story_id === info.shortcode || (t.story_url ?? "").includes(info.shortcode!),
      );
      if (hit) return hit;
    }
    const noQuery = u.split("?")[0]!;
    const file = noQuery.split("/").pop() ?? "";
    const hit = tags.find(
      (t) =>
        (t.story_url && noQuery.includes(t.story_url.split("?")[0]!)) ||
        (file.length > 8 && (t.story_url ?? "").includes(file)),
    );
    if (hit) return hit;
  }
  return null;
}

function parseTags(raw: string | null): StoryTag[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? arr.filter((t): t is StoryTag => Boolean(t && typeof t === "object" && "story_id" in t))
      : [];
  } catch {
    return [];
  }
}

export async function listStoryTags(ctx: TenantContext): Promise<StoryTag[]> {
  return parseTags(await getSetting(ctx, STORY_TAGS_KEY));
}

export async function saveStoryTags(ctx: TenantContext, tags: StoryTag[]): Promise<void> {
  await setSetting(ctx, STORY_TAGS_KEY, JSON.stringify(tags.slice(0, STORY_TAGS_MAX)));
}

export type StoryTagInput = {
  story: string;
  product_id?: string | null;
  product_name: string;
  price?: number | null;
  notes?: string | null;
};

/** Новый тег или замена тега той же сторис. */
export async function upsertStoryTag(ctx: TenantContext, input: StoryTagInput): Promise<StoryTag> {
  const info = extractInstagramMediaInfo(input.story);
  const storyId = info.shortcode ?? input.story.trim();
  if (!storyId) throw new Error("Укажите ссылку на сторис или её id.");
  const tags = await listStoryTags(ctx);
  const tag: StoryTag = {
    id: tags.find((t) => t.story_id === storyId)?.id ?? `st_${Date.now().toString(36)}`,
    story_id: storyId,
    story_url:
      info.type === "unknown"
        ? info.cleanUrl?.startsWith("http")
          ? info.cleanUrl
          : null
        : info.cleanUrl,
    product_id: input.product_id || null,
    product_name: input.product_name.trim(),
    price: input.price ?? null,
    notes: input.notes?.trim() || null,
    created_at: new Date().toISOString(),
  };
  await saveStoryTags(ctx, [tag, ...tags.filter((t) => t.story_id !== storyId)]);
  return tag;
}

export async function deleteStoryTag(ctx: TenantContext, id: string): Promise<void> {
  const tags = await listStoryTags(ctx);
  await saveStoryTags(
    ctx,
    tags.filter((t) => t.id !== id),
  );
}

/** Контекст для модели: что на сторис, на которую ответил покупатель. */
export function storyContextLine(tag: StoryTag | null, storyId: string | null): string {
  if (tag) {
    const price = tag.price != null ? `, цена ${tag.price}` : "";
    const notes = tag.notes ? `. Заметка продавца: ${tag.notes}` : "";
    return `[Клиент ответил на сторис/рилс${storyId ? ` ${storyId}` : ""}. На ней товар «${tag.product_name}»${price}${notes}. Отвечайте про этот товар.]`;
  }
  return `[Клиент ответил на сторис/рилс${storyId ? ` ${storyId}` : ""}, товар к ней не отмечен. Вежливо уточните, какой именно товар со сторис его интересует.]`;
}
