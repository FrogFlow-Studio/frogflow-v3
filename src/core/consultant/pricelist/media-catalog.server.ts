import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ConsultantProduct } from "./catalog";
import { loadPricelist, CATALOG_KEY } from "./catalog.server";
import { modelName } from "./follow-up";
import {
  mediaForProduct,
  parseProductMedia,
  PRODUCT_MEDIA_KEY,
  type ProductMedia,
  type ProductMediaKind,
} from "./media";
import { loadProductMediaStrict, productMediaUrl, updateProductMedia } from "./media.server";
import { getSettings, updateSettingStamped } from "@/core/settings/settings";
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
  totalProducts: number;
  withMediaCount: number;
  withoutMediaCount: number;
  demandedWithoutMediaCount: number;
  withVideoCount: number;
  withPhotoCount: number;
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

const MODEL_STOP_WORDS = new Set([
  "bovi",
  "кпб",
  "кз",
  "цвет",
  "жаккард",
  "сатин",
  "хлопок",
  "подод",
  "наволочки",
  "простыня",
  "простынь",
  "размер",
  "100%",
  "махровое",
  "полотенце",
  "одеяло",
  "подушка",
  "халат",
  "коврик",
  "ванную",
  "в",
  "и",
  "для",
  "наволочка",
  "пододеяльник",
  "комплект",
  "белье",
  "белья",
  "белый",
  "белая",
  "серый",
  "серая",
  "зеленый",
  "зеленая",
  "синий",
  "синяя",
  "розовый",
  "розовая",
  "бежевый",
  "бежевая",
  "голубой",
  "голубая",
  "черный",
  "tc",
  "silk",
  "daune",
  "wk2",
  "wk2+",
  "de",
  "luxe",
  "вышивка",
  "линейка",
  "линейки",
  "суть",
  "клиент",
  "покупатель",
  "просит",
  "фото",
  "видео",
  "базе",
  "нет",
  "шт",
  "штук",
]);

export function getModelCoreTokens(name: string): string[] {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !MODEL_STOP_WORDS.has(w.toLowerCase()));
}

/**
 * Собрать статистику спроса: объединить realtime-счётчик (consultant_media_demands_json)
 * и задачи консультанта (consultant_tasks_json) с reason === "photo" или запросом фото.
 * Исключает задачи, где покупатель сам прислал фото или спрашивал про ассортимент.
 */
export async function loadMediaDemandMap(
  ctx: TenantContext,
  knownCatalogModels?: Iterable<string>,
): Promise<Record<string, MediaDemandItem>> {
  const settings = await getSettings(ctx, [MEDIA_DEMANDS_KEY, TASKS_KEY, CATALOG_KEY]);
  const demands = parseMediaDemands(settings[MEDIA_DEMANDS_KEY]);

  const catalogModels = new Set<string>(knownCatalogModels ?? []);
  if (catalogModels.size === 0 && settings[CATALOG_KEY]) {
    try {
      const rawPl = JSON.parse(settings[CATALOG_KEY]);
      const list = Array.isArray(rawPl) ? rawPl : (rawPl.products ?? []);
      for (const p of list) {
        if (p && typeof p.name === "string") {
          const m = modelName(p.name);
          if (m) catalogModels.add(m);
        }
      }
    } catch {
      // Повреждённый legacy-каталог не блокирует загрузку остальных медиа-данных.
    }
  }

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

      const taskText = task.text ?? "";
      // Исключаем случаи, когда покупатель сам скинул фото (например, своей куртки/шапки)
      const isSendingMedia =
        /прислал(?:а)?\s+(?:фото|видео)|отправил(?:а)?\s+(?:фото|видео)|скинул(?:а)?\s+(?:фото|видео)/i.test(
          taskText,
        );
      // Исключаем общие вопросы по ассортименту ("где посмотреть ассортимент?")
      const isShopQuestion =
        /где\s+посмотреть|посмотреть\s+(?:ассортимент|каталог|сайт|наличие)/i.test(taskText);
      // Проверяем явный запрос фото/видео клиентом
      const isAskingMedia =
        /просит\s+(?:фото|видео)|нужно\s+(?:фото|видео)|вышлите\s+(?:фото|видео)|пришлите\s+(?:фото|видео)|отправьте\s+(?:фото|видео)|покажите\s+(?:фото|видео)|хочет\s+(?:фото|видео)|можно\s+(?:их\s+)?(?:фото|видео)/i.test(
          taskText,
        );

      const isPhotoTask =
        (task.reason === "photo" || isAskingMedia) && !isSendingMedia && !isShopQuestion;
      if (!isPhotoTask) continue;

      const requestedModels = new Set<string>();
      const taskTextLower = taskText.toLowerCase();

      if (Array.isArray(task.products) && task.products.length > 0) {
        const prodModels = Array.from(
          new Set(task.products.map((p) => modelName(p)).filter(Boolean)),
        );
        if (prodModels.length === 1 && prodModels[0]) {
          requestedModels.add(prodModels[0]);
        } else if (prodModels.length > 1) {
          // Если в задаче несколько товаров, проверяем, о каких именно шла речь в запросе
          const mentioned = prodModels.filter((m) => {
            const tokens = getModelCoreTokens(m);
            return tokens.some((tok) => taskTextLower.includes(tok.toLowerCase()));
          });
          if (mentioned.length > 0) {
            mentioned.forEach((m) => requestedModels.add(m));
          } else {
            prodModels.forEach((m) => requestedModels.add(m));
          }
        }
      } else if (taskText && catalogModels.size > 0) {
        // Если поле products не заполнено, сопоставляем только с реальными моделями каталога
        for (const mName of catalogModels) {
          const coreTokens = getModelCoreTokens(mName);
          if (coreTokens.length > 0) {
            const allTokensPresent = coreTokens.every((tok) =>
              taskTextLower.includes(tok.toLowerCase()),
            );
            if (allTokensPresent) {
              if (/кпб|комплект/i.test(taskTextLower) && /наволочк/i.test(mName.toLowerCase())) {
                continue;
              }
              requestedModels.add(mName);
            }
          }
        }
      }

      // Чистим текст запроса покупателя от системных приписок ("О покупателе: ...")
      const cleanText = taskText
        ? taskText
            .replace(/\r?\n/g, " ")
            .replace(/\s*О покупателе:.*$/i, "")
            .trim()
            .slice(0, 160)
        : undefined;

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
          text: cleanText,
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
  const [snapshot, mediaList] = await Promise.all([
    loadPricelist(ctx, 0),
    loadProductMediaStrict(ctx),
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

  // Загружаем статистику спроса с известными моделями каталога
  const demandsMap = await loadMediaDemandMap(ctx, modelsMap.keys());

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

    // Точное сопоставление спроса по имени модели (без ошибочных подстрок)
    const normMName = mName.trim().toLowerCase();
    const dItem =
      demandsMap[mName] ??
      Object.entries(demandsMap).find(([k]) => k.trim().toLowerCase() === normMName)?.[1];

    let demandCount = 0;
    let lastRequestedAt: string | undefined;
    const requestsSample: Array<{ at: string; contact?: string; text?: string }> = [];

    if (dItem) {
      demandCount = dItem.count;
      lastRequestedAt = dItem.lastRequestedAt;
      requestsSample.push(...dItem.requests);
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

  const withPhotoCount = modelOverviews.filter((m) => m.hasPhoto).length;
  const withVideoCount = modelOverviews.filter((m) => m.hasVideo).length;
  const withMediaCount = modelOverviews.filter((m) => m.hasPhoto || m.hasVideo).length;
  const withoutMediaCount = modelOverviews.length - withMediaCount;
  const demandedWithoutMediaCount = modelOverviews.filter(
    (m) => m.demandCount > 0 && !m.hasPhoto && !m.hasVideo,
  ).length;

  return {
    models: modelOverviews,
    totalModels: modelOverviews.length,
    totalProducts: snapshot.products.length,
    withMediaCount,
    withoutMediaCount,
    demandedWithoutMediaCount,
    withVideoCount,
    withPhotoCount,
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
    throw new UserError(
      "err.pricelist.noMatch",
      "Укажите модель, как в прайсе: например «Uchino Zero Twist».",
    );
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
    const settings = await getSettings(ctx, [
      MEDIA_DEMANDS_KEY,
      TASKS_KEY,
      PRODUCT_MEDIA_KEY,
      CATALOG_KEY,
    ]);
    const media = parseProductMedia(settings[PRODUCT_MEDIA_KEY]);
    const demands = await loadMediaDemandMap(ctx);

    let unfulfilled = 0;
    for (const [model, dItem] of Object.entries(demands)) {
      if (dItem.count <= 0) continue;
      const normModel = model.trim().toLowerCase();
      const hasMedia = media.some((m) => {
        const normMatch = m.match.trim().toLowerCase();
        return (
          normModel === normMatch || normModel.includes(normMatch) || normMatch.includes(normModel)
        );
      });
      if (!hasMedia) unfulfilled++;
    }
    return unfulfilled;
  } catch (e) {
    console.warn(`[consultant:${ctx.tenant.id}] сбой подсчёта бейджа медиа:`, e);
    return 0;
  }
}
