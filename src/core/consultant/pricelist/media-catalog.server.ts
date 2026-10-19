import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ConsultantProduct } from "./catalog";
import { loadPricelist } from "./catalog.server";
import { modelName } from "./follow-up";
import {
  mediaForProduct,
  parseProductMedia,
  PRODUCT_MEDIA_KEY,
  type ProductMedia,
  type ProductMediaKind,
} from "./media";
import {
  loadProductMediaStrict,
  productMediaUrl,
  updateProductMedia,
} from "./media.server";
import { getSettings, getSettingsStrict, updateSettingStamped } from "@/core/settings/settings";
import { isIssuedUploadKey } from "@/core/storage/upload";
import { UserError } from "@/core/i18n/user-error";

export const MEDIA_DEMANDS_KEY = "consultant_media_demands_json";
export const TASKS_KEY = "consultant_tasks_json";

export type MediaDemandItem = {
  model: string;
  count: number;
  lastRequestedAt: string;
  requests: Array<{ at: string; contact?: string; text?: string }>;
};

export type ModelMediaFile = {
  id: string;
  path: string;
  url: string;
  kind: ProductMediaKind;
  color?: string;
  name?: string;
  createdAt: string;
};

export type CatalogModelOverview = {
  id: string;
  name: string;
  category: string;
  colors: string[];
  sizes: string[];
  minPriceKzt: number;
  maxPriceKzt: number;
  productsCount: number;
  hasPhoto: boolean;
  hasVideo: boolean;
  media: ModelMediaFile[];
  demandCount: number;
  lastRequestedAt?: string;
  requestsSample: Array<{ at: string; contact?: string; text?: string }>;
};

export type ConsultantMediaPageData = {
  models: CatalogModelOverview[];
  totalModels: number;
  withMediaCount: number;
  withoutMediaCount: number;
  demandedWithoutMediaCount: number;
  totalMediaFiles: number;
  shopUrl: string;
};

/** Извлечь сырые записи спроса на медиа. */
export function parseMediaDemands(raw: unknown): Record<string, MediaDemandItem> {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return {};
    const res: Record<string, MediaDemandItem> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") {
        const item = v as Partial<MediaDemandItem>;
        res[k] = {
          model: String(item.model ?? k),
          count: Number(item.count ?? 1),
          lastRequestedAt: String(item.lastRequestedAt ?? new Date().toISOString()),
          requests: Array.isArray(item.requests) ? item.requests : [],
        };
      }
    }
    return res;
  } catch {
    return {};
  }
}

/**
 * Собрать статистику спроса: объединить realtime-счётчик (consultant_media_demands_json)
 * и задачи консультанта (consultant_tasks_json) с reason === "photo" или упоминанием фото.
 */
export async function loadMediaDemandMap(
  ctx: TenantContext,
): Promise<Record<string, MediaDemandItem>> {
  const settings = await getSettings(ctx, [MEDIA_DEMANDS_KEY, TASKS_KEY]);
  const demands = parseMediaDemands(settings[MEDIA_DEMANDS_KEY]);

  try {
    const rawTasks = settings[TASKS_KEY];
    const tasks = Array.isArray(rawTasks)
      ? rawTasks
      : typeof rawTasks === "string"
        ? (JSON.parse(rawTasks) as unknown[])
        : [];

    for (const t of tasks) {
      if (!t || typeof t !== "object") continue;
      const task = t as {
        reason?: string;
        text?: string;
        products?: string[];
        at?: string;
        contact?: string;
      };
      const isPhotoTask =
        task.reason === "photo" ||
        (task.text && /фото|видео|посмотреть|показать/i.test(task.text));

      if (!isPhotoTask) continue;

      const requestedModels = new Set<string>();
      if (Array.isArray(task.products) && task.products.length > 0) {
        for (const p of task.products) {
          const m = modelName(p);
          if (m) requestedModels.add(m);
        }
      } else if (task.text) {
        // Попытка извлечь модель из текста задачи, если products не заполнены
        const m = modelName(task.text);
        if (m && m.length > 3) requestedModels.add(m);
      }

      for (const m of requestedModels) {
        if (!demands[m]) {
          demands[m] = {
            model: m,
            count: 0,
            lastRequestedAt: task.at ?? new Date().toISOString(),
            requests: [],
          };
        }
        demands[m].count++;
        if (task.at && new Date(task.at) > new Date(demands[m].lastRequestedAt)) {
          demands[m].lastRequestedAt = task.at;
        }
        demands[m].requests.push({
          at: task.at ?? new Date().toISOString(),
          contact: task.contact,
          text: task.text?.slice(0, 150),
        });
      }
    }
  } catch (e) {
    console.warn(`[consultant:${ctx.tenant.id}] сбой парсинга задач для спроса на фото`, e);
  }

  return demands;
}

/** Зафиксировать запрос фото/видео клиентом в Direct. */
export async function recordMediaDemand(
  ctx: TenantContext,
  product: ConsultantProduct,
  contact?: string,
  text?: string,
  now = new Date(),
): Promise<void> {
  const model = modelName(product.name);
  if (!model) return;

  await updateSettingStamped(ctx, MEDIA_DEMANDS_KEY, (raw) => {
    const demands = parseMediaDemands(raw);
    const item = demands[model] ?? {
      model,
      count: 0,
      lastRequestedAt: now.toISOString(),
      requests: [],
    };
    item.count++;
    item.lastRequestedAt = now.toISOString();
    item.requests.unshift({
      at: now.toISOString(),
      contact,
      text: text?.slice(0, 150),
    });
    item.requests = item.requests.slice(0, 20); // храним до 20 последних запросов
    demands[model] = item;
    return JSON.stringify(demands);
  }).catch((e) => {
    console.error(`[consultant:${ctx.tenant.id}] ошибка записи спроса на медиа:`, e);
  });
}

/** Сгруппировать каталог по уникальным моделям и сопоставить с фото и видео. */
export async function loadCatalogMediaOverview(
  ctx: TenantContext,
): Promise<ConsultantMediaPageData> {
  const [snapshot, mediaList, demandsMap] = await Promise.all([
    loadPricelist(ctx, 0),
    loadProductMediaStrict(ctx),
    loadMediaDemandMap(ctx),
  ]);

  const modelsMap = new Map<
    string,
    {
      name: string;
      category: string;
      colors: Set<string>;
      sizes: Set<string>;
      minPrice: number;
      maxPrice: number;
      products: ConsultantProduct[];
    }
  >();

  for (const p of snapshot.products) {
    const m = modelName(p.name);
    if (!modelsMap.has(m)) {
      modelsMap.set(m, {
        name: m,
        category: p.category || "Общее",
        colors: new Set(),
        sizes: new Set(),
        minPrice: p.price_kzt,
        maxPrice: p.price_kzt,
        products: [],
      });
    }
    const item = modelsMap.get(m)!;
    item.products.push(p);
    (p.colors ?? []).forEach((c) => item.colors.add(c));
    if (p.size) item.sizes.add(p.size);
    if (p.price_kzt < item.minPrice) item.minPrice = p.price_kzt;
    if (p.price_kzt > item.maxPrice) item.maxPrice = p.price_kzt;
  }

  const modelOverviews: CatalogModelOverview[] = [];

  for (const [mName, item] of modelsMap.entries()) {
    // Найти медиа, подходящие к любой позиции этой модели
    const matchedMedia = new Map<string, ModelMediaFile>();
    for (const p of item.products) {
      const found = mediaForProduct(mediaList, p);
      for (const m of found) {
        if (!matchedMedia.has(m.id)) {
          matchedMedia.set(m.id, {
            id: m.id,
            path: m.path,
            url: productMediaUrl(ctx, m.path),
            kind: m.kind,
            color: m.color,
            name: m.name,
            createdAt: m.createdAt,
          });
        }
      }
    }

    const media = Array.from(matchedMedia.values());
    const hasPhoto = media.some((m) => m.kind === "image");
    const hasVideo = media.some((m) => m.kind === "video");

    // Проверить спрос на модель
    // Поиск совпадений по имени модели или вхождению
    let demandCount = 0;
    let lastRequestedAt: string | undefined;
    const requestsSample: Array<{ at: string; contact?: string; text?: string }> = [];

    for (const [dModel, dItem] of Object.entries(demandsMap)) {
      if (
        dModel.toLowerCase() === mName.toLowerCase() ||
        mName.toLowerCase().includes(dModel.toLowerCase()) ||
        dModel.toLowerCase().includes(mName.toLowerCase())
      ) {
        demandCount += dItem.count;
        if (!lastRequestedAt || new Date(dItem.lastRequestedAt) > new Date(lastRequestedAt)) {
          lastRequestedAt = dItem.lastRequestedAt;
        }
        requestsSample.push(...dItem.requests);
      }
    }

    modelOverviews.push({
      id: mName,
      name: mName,
      category: item.category,
      colors: Array.from(item.colors).filter(Boolean),
      sizes: Array.from(item.sizes).filter(Boolean),
      minPriceKzt: item.minPrice === Infinity ? 0 : item.minPrice,
      maxPriceKzt: item.maxPrice === -Infinity ? 0 : item.maxPrice,
      productsCount: item.products.length,
      hasPhoto,
      hasVideo,
      media,
      demandCount,
      lastRequestedAt,
      requestsSample: requestsSample.slice(0, 5),
    });
  }

  // Сортировка:
  // 1. Горящие модели (просили покупатели, а медиа нет) - сверху
  // 2. Модели с медиа
  // 3. Остальные
  modelOverviews.sort((a, b) => {
    const aUrgent = a.demandCount > 0 && !a.hasPhoto && !a.hasVideo;
    const bUrgent = b.demandCount > 0 && !b.hasPhoto && !b.hasVideo;
    if (aUrgent && !bUrgent) return -1;
    if (!aUrgent && bUrgent) return 1;
    if (a.demandCount !== b.demandCount) return b.demandCount - a.demandCount;
    return a.name.localeCompare(b.name, "ru");
  });

  const withMediaCount = modelOverviews.filter((m) => m.hasPhoto || m.hasVideo).length;
  const withoutMediaCount = modelOverviews.length - withMediaCount;
  const demandedWithoutMediaCount = modelOverviews.filter(
    (m) => m.demandCount > 0 && !m.hasPhoto && !m.hasVideo,
  ).length;

  return {
    models: modelOverviews,
    totalModels: modelOverviews.length,
    withMediaCount,
    withoutMediaCount,
    demandedWithoutMediaCount,
    totalMediaFiles: mediaList.length,
    shopUrl: snapshot.shopUrl,
  };
}

/** Загрузить и привязать фото/видео к модели из новой вкладки. */
export async function attachModelMedia(
  ctx: TenantContext,
  data: { key: string; modelName: string; color?: string; name?: string },
  now = new Date(),
): Promise<ProductMedia> {
  if (!isIssuedUploadKey(ctx.tenant.id, data.key)) {
    throw new UserError("err.pricelist.badFile", "Файл не найден — загрузите его ещё раз.");
  }
  const match = data.modelName.trim();
  if (!match) {
    throw new UserError("err.pricelist.noMatch", "Укажите название модели.");
  }

  const isVideo = /\.(mp4|mov)$/i.test(data.key);
  const item: ProductMedia = {
    id: data.key.split("/").pop()!.split(".")[0]!,
    match: match.slice(0, 120),
    ...(data.color?.trim() ? { color: data.color.trim().slice(0, 40) } : {}),
    path: data.key,
    kind: isVideo ? "video" : "image",
    ...(data.name?.trim() ? { name: data.name.trim().slice(0, 120) } : {}),
    createdAt: now.toISOString(),
  };

  await updateProductMedia(ctx, (list) => [...list.filter((m) => m.id !== item.id), item]);
  return item;
}

/** Быстрый подсчёт моделей, по которым покупатели просили фото, а медиа ещё нет (для бейджа в меню). */
export async function openMediaDemandsCount(ctx: TenantContext): Promise<number> {
  try {
    const settings = await getSettings(ctx, [MEDIA_DEMANDS_KEY, TASKS_KEY, PRODUCT_MEDIA_KEY]);
    const demands = parseMediaDemands(settings[MEDIA_DEMANDS_KEY]);
    const media = parseProductMedia(settings[PRODUCT_MEDIA_KEY]);

    const demandedModels = new Set<string>(Object.keys(demands));
    const rawTasks = settings[TASKS_KEY];
    if (Array.isArray(rawTasks) || typeof rawTasks === "string") {
      try {
        const tasks = Array.isArray(rawTasks) ? rawTasks : JSON.parse(rawTasks as string);
        for (const t of tasks) {
          if (t && typeof t === "object") {
            const task = t as { reason?: string; text?: string; products?: string[] };
            if (task.reason === "photo" || (task.text && /фото|видео|посмотреть/i.test(task.text))) {
              if (Array.isArray(task.products)) {
                for (const p of task.products) {
                  const m = modelName(p);
                  if (m) demandedModels.add(m);
                }
              }
            }
          }
        }
      } catch {}
    }

    let unfulfilled = 0;
    for (const model of demandedModels) {
      const normModel = model.toLowerCase();
      const hasMedia = media.some((m) => {
        const normMatch = m.match.toLowerCase();
        return normModel === normMatch || normModel.includes(normMatch) || normMatch.includes(normModel);
      });
      if (!hasMedia) unfulfilled++;
    }
    return unfulfilled;
  } catch (e) {
    console.warn(`[consultant:${ctx.tenant.id}] сбой подсчёта бейджа медиа:`, e);
    return 0;
  }
}

