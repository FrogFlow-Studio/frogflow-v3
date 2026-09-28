import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isInstagramCdnUrl, parsePostCaption, type PostDraft } from "@/core/catalog/ig-import";
import { getSetting, setSetting } from "@/core/settings/settings";
import { UserError } from "@/core/i18n/user-error";

/**
 * Импорт товаров из постов Instagram магазина (core/catalog/ig-import):
 * посты берутся из Zernio заново на сервере — ссылке на картинку от браузера
 * не доверяем; фото скачивается только с CDN Instagram, проверяется по
 * размеру и содержимому и кладётся в бакет товаров под префикс клиента.
 * Товары создаются скрытыми: продавец проверяет цену и включает их сам.
 * Уже импортированные посты помнит строка app_settings `ig_imported`.
 */
const IMPORTED_KEY = "ig_imported";
const MAX_REMEMBERED = 2000;
const MAX_IMAGE = 20 * 1024 * 1024;

export type IgCandidate = {
  postId: string;
  accountId: string;
  thumbnail: string | null;
  permalink: string | null;
  publishedAt: string | null;
  kind: string;
  draft: PostDraft;
};

async function importedIds(ctx: TenantContext): Promise<string[]> {
  try {
    const v = JSON.parse((await getSetting(ctx, IMPORTED_KEY)) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function allPosts(ctx: TenantContext) {
  const { instagramAccounts, listPosts } = await import("@/channels/zernio/automations.server");
  const accounts = instagramAccounts(ctx).filter((a) => !a.expired);
  const lists = await Promise.all(
    accounts.map(async (a) =>
      (await listPosts(ctx, a.id, 2200)).map((p) => ({ ...p, accountId: a.id })),
    ),
  );
  return lists.flat();
}

/** Посты, из которых ещё не делали товар, с черновиком по подписи. */
export async function igImportCandidates(ctx: TenantContext): Promise<IgCandidate[]> {
  const done = new Set(await importedIds(ctx));
  return (await allPosts(ctx))
    .filter((p) => !done.has(p.platformPostId) && !/stor/i.test(p.kind))
    .slice(0, 60)
    .map((p) => ({
      postId: p.platformPostId,
      accountId: p.accountId,
      thumbnail: p.thumbnail,
      permalink: p.permalink,
      publishedAt: p.publishedAt,
      kind: p.kind,
      draft: parsePostCaption(p.caption),
    }));
}

/** Фото поста в бакет товаров; null — не скачалось или не картинка (товар будет без фото). */
async function storePostImage(ctx: TenantContext, url: string | null): Promise<string | null> {
  if (!url || !isInstagramCdnUrl(url)) return null;
  const { readCapped } = await import("@/lib/read-capped");
  const { contentMatchesExt } = await import("@/core/storage/sniff");
  const { newUploadKey } = await import("@/core/storage/upload");
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
    if (!ext) return null;
    const bytes = await readCapped(res, MAX_IMAGE);
    if (!bytes || bytes.length === 0 || !contentMatchesExt(ext, bytes)) return null;
    const key = newUploadKey(ctx.tenant.id, randomBytes(12).toString("hex"), `post.${ext}`);
    const { serviceDb } = await import("@/core/db/client.server");
    const { error } = await serviceDb()
      .storage.from("product-images")
      .upload(key, bytes, { contentType: type, upsert: false });
    return error ? null : key;
  } catch {
    return null;
  }
}

export type IgImportItem = {
  postId: string;
  name: string;
  price: number;
  description: string;
  keywords: string;
};

/** Создать скрытые товары из выбранных постов; возвращает, сколько создано. */
export async function igImportPosts(
  ctx: TenantContext,
  items: IgImportItem[],
  opts: { kind: "digital" | "physical"; categoryId: string | null },
): Promise<{ created: number; withoutPhoto: number }> {
  const posts = new Map((await allPosts(ctx)).map((p) => [p.platformPostId, p]));
  const done = await importedIds(ctx);
  const { createProduct, setProductImages } = await import("@/core/catalog/admin");
  const { shopCurrency } = await import("@/core/discounts/discounts");
  const shop = await shopCurrency(ctx);
  let created = 0;
  let withoutPhoto = 0;
  for (const it of items) {
    const post = posts.get(it.postId);
    if (!post || done.includes(it.postId)) continue;
    const draft = parsePostCaption(post.caption);
    const id = await createProduct(ctx, {
      name: it.name.trim().slice(0, 200) || draft.name,
      description: it.description.slice(0, 5000),
      keywords: it.keywords.slice(0, 500),
      price: Math.max(0, it.price),
      currency: draft.currency ?? shop,
      countryPrices: {},
      categoryIds: opts.categoryId ? [opts.categoryId] : [],
      isActive: false,
      sortOrder: 0,
      fulfillmentKind: opts.kind,
      stockQuantity: null,
      leadTimeDays: null,
    });
    const image = await storePostImage(ctx, post.thumbnail);
    if (image) await setProductImages(ctx, id, [image]);
    else withoutPhoto++;
    done.push(it.postId);
    created++;
  }
  if (created === 0 && items.length > 0)
    throw new UserError("err.igImport.nothing", "Посты не найдены — обновите страницу");
  await setSetting(ctx, IMPORTED_KEY, JSON.stringify(done.slice(-MAX_REMEMBERED)));
  return { created, withoutPhoto };
}
