import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";

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
  /**
   * Все товары истории (v1 8d31840, MIGRATION-71): простыня, пододеяльник и
   * наволочки на одной сторис. product_* — первый из них, как у v1.
   */
  products?: StoryProduct[];
};

export type StoryProduct = { id: string | null; name: string; price: number | null };

/** Товары истории всегда списком: есть products — он, нет — один по старым полям. */
export function storyProductsOf(
  tag: Pick<StoryTag, "product_id" | "product_name" | "price"> & { products?: unknown },
): StoryProduct[] {
  const norm = (raw: unknown): StoryProduct | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) return null;
    const price = Number(r.price ?? r.price_kzt ?? r.priceKzt);
    return {
      id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : null,
      name,
      price: Number.isFinite(price) && price > 0 ? price : null,
    };
  };
  let raw = tag.products;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const list = raw
      .map(norm)
      .filter((p): p is StoryProduct => p !== null)
      .filter((p) => {
        const k = p.id ?? p.name.toLowerCase();
        return seen.has(k) ? false : (seen.add(k), true);
      });
    if (list.length) return list;
  }
  const single = norm({ id: tag.product_id, name: tag.product_name, price: tag.price });
  return single ? [single] : [];
}

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
 * Публикация, из которой пишет покупатель. `permalink` — постоянная ссылка
 * (instagram.com/reel/…): только для поиска тега, не скачивается.
 */
export type StoryRef = {
  storyId: string | null;
  mediaUrl: string | null;
  caption?: string | null;
  permalink?: string | null;
};

/**
 * Тег публикации: по id и медиа, затем по постоянной ссылке. Комментарий
 * приходит с числовым id публикации, а продавец отмечает товары по ссылке на
 * рилс (код DeeOZq0sWyy) — без ссылки такой тег не находился.
 */
export function findStoryTagFor(
  tags: readonly StoryTag[],
  story: StoryRef | null | undefined,
): StoryTag | null {
  if (!story) return null;
  return (
    findStoryTag(tags, story.storyId, story.mediaUrl) ??
    (story.permalink ? findStoryTag(tags, null, story.permalink) : null)
  );
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

/**
 * Теги для записи: сбой чтения — ServerFailure, а не пустой список. Иначе
 * запись поверх «пустого» списка затёрла бы теги продавца.
 */
export async function readStoryTagsForWrite(ctx: TenantContext): Promise<StoryTag[]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", STORY_TAGS_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`Теги сторис не прочитаны (${error.message})`);
  return parseTags((data as { value: string | null } | null)?.value ?? null);
}

export async function saveStoryTags(ctx: TenantContext, tags: StoryTag[]): Promise<void> {
  await setSetting(ctx, STORY_TAGS_KEY, JSON.stringify(tags.slice(0, STORY_TAGS_MAX)));
}

/**
 * Перенос тегов v1 в список v2: дописываются теги, которых в v2 ещё нет
 * (ни по id, ни по сторис) — версия v2 той же сторис главнее, повторный
 * перенос ничего не меняет. Свои теги v2 не убираются никогда: предел `max`
 * урезает только дописываемые из v1 (сначала новые по времени), сколько не
 * влезло — `dropped`, чтобы обрезка не была тихой.
 */
export function mergeLegacyStoryTags(
  existing: readonly StoryTag[],
  legacy: readonly StoryTag[],
  max: number,
): { tags: StoryTag[]; added: number; dropped: number } {
  const ids = new Set(existing.map((t) => t.id));
  const stories = new Set(existing.map((t) => t.story_id));
  const fresh: StoryTag[] = [];
  for (const t of legacy) {
    if (ids.has(t.id) || stories.has(t.story_id)) continue;
    ids.add(t.id);
    stories.add(t.story_id);
    fresh.push(t);
  }
  fresh.sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : b.created_at.localeCompare(a.created_at),
  );
  const taken = fresh.slice(0, Math.max(0, max - existing.length));
  return {
    tags: [...existing, ...taken],
    added: taken.length,
    dropped: fresh.length - taken.length,
  };
}

export type StoryTagInput = {
  story: string;
  /** Все товары публикации; первый — он же product_* (как у v1). */
  products: StoryProduct[];
  notes?: string | null;
};

/** Не больше стольких товаров на одну публикацию. */
export const STORY_PRODUCTS_MAX = 10;

/** Новый тег или замена тега той же сторис. */
export async function upsertStoryTag(ctx: TenantContext, input: StoryTagInput): Promise<StoryTag> {
  const info = extractInstagramMediaInfo(input.story);
  const storyId = info.shortcode ?? input.story.trim();
  if (!storyId)
    throw new UserError("err.stories.idRequired", "Укажите ссылку на сторис или её id.");
  const products = storyProductsOf({
    product_id: null,
    product_name: "",
    price: null,
    products: input.products,
  }).slice(0, STORY_PRODUCTS_MAX);
  const first = products[0];
  if (!first)
    throw new UserError("err.stories.productRequired", "Выберите товар или впишите его название.");
  const tags = await readStoryTagsForWrite(ctx);
  const tag: StoryTag = {
    id: tags.find((t) => t.story_id === storyId)?.id ?? `st_${Date.now().toString(36)}`,
    story_id: storyId,
    story_url:
      info.type === "unknown"
        ? info.cleanUrl?.startsWith("http")
          ? info.cleanUrl
          : null
        : info.cleanUrl,
    product_id: first.id,
    product_name: first.name,
    price: first.price,
    products,
    notes: input.notes?.trim() || null,
    created_at: new Date().toISOString(),
  };
  await saveStoryTags(ctx, [tag, ...tags.filter((t) => t.story_id !== storyId)]);
  return tag;
}

export async function deleteStoryTag(ctx: TenantContext, id: string): Promise<void> {
  const tags = await readStoryTagsForWrite(ctx);
  await saveStoryTags(
    ctx,
    tags.filter((t) => t.id !== id),
  );
}

/** Контекст для модели: что на сторис, на которую ответил покупатель. */
/**
 * Подпись публикации одной строкой для пометки модели: без переносов и
 * квадратных скобок (ими пометка закрывается), не длиннее 600 знаков.
 */
export function storyCaptionText(caption: string | null | undefined): string {
  const flat = (caption ?? "").replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 600 ? `${flat.slice(0, 600)}…` : flat;
}

export function storyContextLine(
  tag: StoryTag | null,
  storyId: string | null,
  caption?: string | null,
): string {
  const head = `[Клиент ответил на сторис/рилс${storyId ? ` ${storyId}` : ""}`;
  if (tag) {
    const notes = tag.notes ? `. Заметка продавца: ${tag.notes}` : "";
    const items = storyProductsOf(tag);
    if (items.length > 1) {
      const list = items
        .map((p) => `«${p.name}»${p.price != null ? ` — ${p.price}` : ""}`)
        .join("; ");
      return `${head}. На ней несколько товаров: ${list}${notes}. Назовите их с ценами и уточните, какой интересует.]`;
    }
    const price = tag.price != null ? `, цена ${tag.price}` : "";
    return `${head}. На ней товар «${tag.product_name}»${price}${notes}. Отвечайте про этот товар.]`;
  }
  const text = storyCaptionText(caption);
  if (text) {
    return `${head}, товар к ней не отмечен. Подпись публикации: «${text}». Поймите по подписи, о каком товаре речь, и отвечайте про него; если по подписи не понять — уточните.]`;
  }
  return `${head}, товар к ней не отмечен. Вежливо уточните, какой именно товар со сторис его интересует.]`;
}
