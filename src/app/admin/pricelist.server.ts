import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import {
  loadPricelist,
  savePricelist,
  saveSynonyms,
  SHOP_URL_KEY,
} from "@/core/consultant/pricelist/catalog.server";
import { parseCatalogCsv } from "@/core/consultant/pricelist/import";
import { loadKnowledge, saveKnowledge } from "@/core/consultant/pricelist/knowledge.server";
import type { ConsultantKnowledgeArticle } from "@/core/consultant/pricelist/knowledge";
import {
  loadProductMedia,
  productMediaUrl,
  saveProductMedia,
} from "@/core/consultant/pricelist/media.server";
import type { ProductMedia } from "@/core/consultant/pricelist/media";
import { isRateFresh } from "@/core/consultant/pricelist/rate";
import {
  getStoredRate,
  loadAttemptLog,
  rateSourceLabel,
  refreshRate,
  saveRate,
} from "@/core/consultant/pricelist/rate.server";
import {
  getStoreInfo,
  saveStoreInfo,
  type StoreInfo,
} from "@/core/consultant/pricelist/store-info.server";
import { pricelistHours, pricelistMode } from "@/core/consultant/pricelist/mode";
import { getSetting, setSetting } from "@/core/settings/settings";
import { FOLLOW_UP_SETTING_KEY } from "@/core/consultant/pricelist/follow-up";
import { loadConsultantUsage } from "@/core/consultant/runs";
import { isIssuedUploadKey } from "@/core/storage/upload";

/**
 * Страница «Прайс консультанта» (перенос панели BOVI v1): выгрузка 1С,
 * синонимы марок, бутик, курс рубля, фотобаза и статьи базы знаний. Только
 * для магазинов, которым оператор включил консультанта по прайсу.
 */
export function requirePricelist(ctx: TenantContext): TenantContext {
  if (!pricelistMode(ctx.tenant))
    throw new UserError(
      "err.pricelist.off",
      "Консультант по прайсу у магазина не включён — его включает оператор.",
    );
  return ctx;
}

export async function pricelistOverview(ctx: TenantContext) {
  requirePricelist(ctx);
  const [snap, stored, attempt, store, media, articles, usage] = await Promise.all([
    loadPricelist(ctx, 0),
    getStoredRate(ctx),
    loadAttemptLog(ctx),
    getStoreInfo(ctx),
    loadProductMedia(ctx),
    loadKnowledge(ctx),
    loadConsultantUsage(ctx),
  ]);
  const p = ctx.tenant.settings.consultant_pricelist ?? {};
  return {
    meta: snap.meta,
    count: snap.products.length,
    hidden: snap.hidden.length,
    synonyms: snap.synonymsText,
    shopUrl: snap.shopUrl,
    store,
    hours: pricelistHours(ctx.tenant),
    rateSource: p.rate_source ?? "vtb",
    rate: stored
      ? {
          rate: stored.rate,
          sell: stored.sell ?? null,
          updatedAt: stored.updatedAt,
          source: rateSourceLabel(stored.source),
          fresh: isRateFresh(stored),
        }
      : null,
    attempt,
    media: media.map((m) => ({ ...m, url: productMediaUrl(ctx, m.path) })),
    articles: articles.map((a) => ({ id: a.id, title: a.title, tags: a.tags, content: a.content })),
    usage,
    followUp: (await getSetting(ctx, FOLLOW_UP_SETTING_KEY))?.trim() === "on",
  };
}

/** Выгрузка 1С (CSV): разбор, проверка, замена прайса. Ошибки строк — продавцу. */
export async function importPricelist(ctx: TenantContext, csv: string, fileName: string) {
  requirePricelist(ctx);
  const parsed = parseCatalogCsv(csv);
  if (parsed.products.length === 0)
    throw new UserError(
      "err.pricelist.empty",
      "В файле не нашлось ни одной позиции. Нужна выгрузка 1С в CSV: название, раздел, размер, цена.",
    );
  const meta = await savePricelist(ctx, parsed.products, fileName.slice(0, 120) || "CSV");
  return { meta, errors: parsed.errors.slice(0, 20), errorCount: parsed.errors.length };
}

export async function savePricelistSettings(
  ctx: TenantContext,
  data: { synonyms: string; shopUrl: string; store: StoreInfo; followUp?: boolean },
) {
  requirePricelist(ctx);
  const url = data.shopUrl.trim();
  if (url && !/^https:\/\/[^\s/]+/i.test(url))
    throw new UserError("err.pricelist.badUrl", "Адрес сайта должен начинаться с https://");
  await saveSynonyms(ctx, data.synonyms);
  await setSetting(ctx, SHOP_URL_KEY, url);
  await saveStoreInfo(ctx, data.store);
  if (data.followUp !== undefined)
    await setSetting(ctx, FOLLOW_UP_SETTING_KEY, data.followUp ? "on" : "off");
  return { ok: true };
}

/** Курс вручную — когда оператор выбрал ручной источник или банк молчит. */
export async function setManualRate(ctx: TenantContext, rate: number) {
  requirePricelist(ctx);
  if (!(rate > 1 && rate < 20))
    throw new UserError(
      "err.pricelist.badRate",
      "Курс рубля к тенге — число от 1 до 20, например 4,79.",
    );
  const stored = await saveRate(ctx, Math.round(rate * 10000) / 10000, "manual");
  return { rate: stored.rate, updatedAt: stored.updatedAt };
}

export async function refreshPricelistRate(ctx: TenantContext) {
  requirePricelist(ctx);
  const r = await refreshRate(ctx);
  return {
    ok: r.ok,
    fetched: r.fetched,
    error: r.error ?? null,
    rate: r.stored?.rate ?? null,
    log: r.log ?? [],
  };
}

/** Файл уже в бакете (upload kind consultantMedia) — в фотобазу по модели из прайса. */
export async function addProductMedia(
  ctx: TenantContext,
  data: { key: string; match: string; color?: string; name?: string },
  now = new Date(),
): Promise<ProductMedia> {
  requirePricelist(ctx);
  if (!isIssuedUploadKey(ctx.tenant.id, data.key))
    throw new UserError("err.pricelist.badFile", "Файл не найден — загрузите его ещё раз.");
  const match = data.match.trim();
  if (!match)
    throw new UserError(
      "err.pricelist.noMatch",
      "Укажите модель, как в прайсе: например «Uchino Zero Twist».",
    );
  const item: ProductMedia = {
    id: data.key.split("/").pop()!.split(".")[0]!,
    match: match.slice(0, 120),
    ...(data.color?.trim() ? { color: data.color.trim().slice(0, 40) } : {}),
    path: data.key,
    kind: /\.(mp4|mov)$/i.test(data.key) ? "video" : "image",
    ...(data.name?.trim() ? { name: data.name.trim().slice(0, 120) } : {}),
    createdAt: now.toISOString(),
  };
  const list = await loadProductMedia(ctx);
  await saveProductMedia(ctx, [...list.filter((m) => m.id !== item.id), item]);
  return item;
}

/** Убрать файл из фотобазы; сам файл удаляется из бакета, если он этого магазина. */
export async function deleteProductMedia(ctx: TenantContext, id: string) {
  requirePricelist(ctx);
  const list = await loadProductMedia(ctx);
  const gone = list.find((m) => m.id === id);
  if (!gone) return { ok: true };
  await saveProductMedia(
    ctx,
    list.filter((m) => m.id !== id),
  );
  if (gone.path.startsWith(`${ctx.tenant.id}/`)) {
    const { serviceDb } = await import("@/core/db/client.server");
    await serviceDb()
      .storage.from("product-images")
      .remove([gone.path])
      .catch(() => null);
  }
  return { ok: true };
}

export async function savePricelistArticles(
  ctx: TenantContext,
  articles: Array<{ id?: string; title: string; tags?: string[]; content: string }>,
  now = new Date(),
) {
  requirePricelist(ctx);
  const clean: ConsultantKnowledgeArticle[] = articles
    .filter((a) => a.title.trim() && a.content.trim())
    .map((a, i) => ({
      id: a.id?.trim() || `kb-${now.getTime().toString(36)}-${i}`,
      title: a.title.trim().slice(0, 200),
      tags: (a.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      content: a.content.trim().slice(0, 30_000),
      updatedAt: now.toISOString(),
    }));
  await saveKnowledge(ctx, clean);
  return { count: clean.length };
}
