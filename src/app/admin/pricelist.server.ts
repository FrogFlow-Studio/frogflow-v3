import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import {
  loadPricelist,
  savePricelist,
  saveSynonyms,
  SHOP_URL_KEY,
} from "@/core/consultant/pricelist/catalog.server";
import { parseCatalogCsv } from "@/core/consultant/pricelist/import";
import {
  appendKnowledge,
  changeKnowledge,
  loadKnowledge,
} from "@/core/consultant/pricelist/knowledge.server";
import type { ConsultantKnowledgeArticle } from "@/core/consultant/pricelist/knowledge";
import {
  articlesFromText,
  KNOWLEDGE_ARTICLE_MAX_CHARS,
  KNOWLEDGE_FILE_MAX_MB,
  KNOWLEDGE_MAX_ARTICLES,
  previewMerge,
  type ImportedArticle,
} from "@/core/consultant/pricelist/knowledge-import";
import type { DocumentTextFailure } from "@/core/consultant/pricelist/doc-text";
import {
  disconnectPricelistSheet,
  importPricelistSheet,
  loadSheetLink,
  previewPricelistSheet,
  storedRows,
} from "@/core/consultant/pricelist/sheet.server";
import { diffPricelists, pricesJumped } from "@/core/consultant/pricelist/sheet";
import { downloadDriveFile } from "@/core/consultant/pricelist/drive.server";
import { xlsxToCsv } from "@/core/catalog/xlsx.server";
import { sheetCsvUrl } from "@/core/catalog/sheet";
import type { FetchLike } from "@/core/catalog/sheet.server";
import {
  loadProductMediaStrict,
  productMediaUrl,
  updateProductMedia,
} from "@/core/consultant/pricelist/media.server";
import { mediaMatchesProduct, type ProductMedia } from "@/core/consultant/pricelist/media";
import { effectiveRateSource, isRateFresh } from "@/core/consultant/pricelist/rate";
import {
  getStoredRate,
  loadAttemptLog,
  FINKAZ_KASPI_URL,
  VTB_ONLINE_API_URL,
  rateSourceLabel,
  refreshRate,
  saveRate,
} from "@/core/consultant/pricelist/rate.server";
import {
  getStoreInfo,
  saveStoreInfo,
  type StoreInfo,
} from "@/core/consultant/pricelist/store-info.server";
import { pricelistHours, pricelistMode, type ShopHours } from "@/core/consultant/pricelist/mode";
import {
  cleanPersona,
  DEFAULT_PERSONA,
  isDefaultPersona,
  PERSONA_LIMITS,
  type PricelistPersona,
} from "@/core/consultant/pricelist/persona";
import { clearTasks, loadTasks, setTaskDone } from "@/core/consultant/tasks";
import { getSetting, setSetting } from "@/core/settings/settings";
import { FOLLOW_UP_SETTING_KEY, followUpEnabled } from "@/core/consultant/pricelist/follow-up";
import { DIGEST_SETTING_KEY } from "@/core/consultant/pricelist/quality-digest";
import { loadConsultantUsage } from "@/core/consultant/runs";
import { isIssuedUploadKey } from "@/core/storage/upload";

/**
 * Страница «Прайс консультанта» (перенос панели BOVI v1): выгрузка 1С,
 * синонимы марок, бутик, курс рубля, фотобаза и статьи базы знаний. Только
 * для магазинов, которым оператор включил консультанта по прайсу.
 */
/** Запись в bots.settings — через справочник арендаторов (условно по rev). */
async function patchSettings(botId: string, patch: Record<string, unknown>): Promise<void> {
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(botId, patch);
}

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
  const [snap, stored, attempt, store, media, articles, usage, sheet] = await Promise.all([
    loadPricelist(ctx, 0),
    getStoredRate(ctx),
    loadAttemptLog(ctx),
    getStoreInfo(ctx),
    loadProductMediaStrict(ctx),
    loadKnowledge(ctx),
    loadConsultantUsage(ctx),
    loadSheetLink(ctx),
  ]);
  const p = ctx.tenant.settings.consultant_pricelist ?? {};
  return {
    meta: snap.meta,
    sheet,
    count: snap.products.length,
    hidden: snap.hidden.length,
    synonyms: snap.synonymsText,
    shopUrl: snap.shopUrl,
    store,
    hours: pricelistHours(ctx.tenant),
    persona: p.persona ?? DEFAULT_PERSONA,
    personaCustom: Boolean(p.persona),
    personaLimits: PERSONA_LIMITS,
    rateSource: effectiveRateSource(p),
    // Откуда бот берёт курс сейчас — не путать с источником сохранённого курса
    // (BOVI 09.10: «Kaspi» у старого курса читался как текущий источник).
    rateFrom:
      effectiveRateSource(p) === "manual"
        ? null
        : rateSourceLabel(
            effectiveRateSource(p) === "vtb" ? VTB_ONLINE_API_URL : p.rate_url || FINKAZ_KASPI_URL,
          ),
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
    media: media.map((m) => ({
      ...m,
      url: productMediaUrl(ctx, m.path),
      /** К скольким позициям прайса подходит (то же правило, что при ответе покупателю). */
      matches: snap.products.filter((p) => mediaMatchesProduct(m, p)).length,
    })),
    /**
     * Названия и цвета позиций для фотобазы: подсказка модели при вводе и
     * проверка «подходит ли хоть одной позиции» до сохранения (без повторов).
     */
    mediaCandidates: [
      ...new Map(
        snap.products.map((p) => [
          `${p.name}|${p.colors.join(",")}`,
          { name: p.name, colors: p.colors },
        ]),
      ).values(),
    ],
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      tags: a.tags,
      content: a.content,
      updatedAt: a.updatedAt,
    })),
    usage,
    followUp: followUpEnabled(await getSetting(ctx, FOLLOW_UP_SETTING_KEY)),
    qualityDigest: (await getSetting(ctx, DIGEST_SETTING_KEY))?.trim() === "on",
  };
}

/**
 * Выгрузка 1С (CSV или Excel, уже переведённый в CSV): разбор, проверка,
 * замена прайса. Ошибки строк и разница с прежним прайсом — продавцу.
 * Цены изменились подозрительно сильно (pricesJumped: сдвиг столбца, курс
 * вместо цены) — без `confirm` ничего не пишем, продавец видит разницу и
 * подтверждает. Подключённая таблица отключается: иначе автообновление через
 * четверть часа заменило бы загруженный файл таблицей.
 */
export async function importPricelist(
  ctx: TenantContext,
  csv: string,
  fileName: string,
  opts: { confirm?: boolean } = {},
) {
  requirePricelist(ctx);
  const parsed = parseCatalogCsv(csv);
  if (parsed.products.length === 0)
    throw new UserError(
      "err.pricelist.empty",
      "В файле не нашлось ни одной позиции. Нужна выгрузка 1С в CSV или Excel: название, раздел, размер, цена.",
    );
  const [before, sheet] = await Promise.all([storedRows(ctx), loadSheetLink(ctx)]);
  const diff = diffPricelists(before, parsed.products);
  const errors = parsed.errors.slice(0, 20);
  if (!opts.confirm && pricesJumped(before, parsed.products))
    return {
      needsConfirm: true as const,
      count: parsed.products.length,
      diff,
      errors,
      errorCount: parsed.errors.length,
    };
  const meta = await savePricelist(ctx, parsed.products, fileName.slice(0, 120) || "CSV");
  const sheetDisconnected = Boolean(sheet);
  if (sheetDisconnected) await disconnectPricelistSheet(ctx);
  return {
    needsConfirm: false as const,
    meta,
    diff,
    sheetDisconnected,
    errors,
    errorCount: parsed.errors.length,
  };
}

/** Файл Excel (.xlsx) — в CSV для того же разбора: перевод строки в ячейке — пробел. */
export function pricelistCsvFromXlsx(data: Buffer): string {
  return xlsxToCsv(data, { singleLine: true });
}

/** Разовая загрузка по ссылке Google Drive на файл (CSV или Excel), как файл из админки. */
export async function importPricelistDrive(
  ctx: TenantContext,
  url: string,
  opts: { confirm?: boolean } = {},
  fetchImpl?: FetchLike,
) {
  requirePricelist(ctx);
  const file = await downloadDriveFile(url, fetchImpl);
  const csv = file.kind === "xlsx" ? pricelistCsvFromXlsx(file.data) : file.text;
  return importPricelist(ctx, csv, "Google Drive", opts);
}

function requireSheetLink(url: string): string {
  if (!sheetCsvUrl(url))
    throw new UserError(
      "err.catalog.sheetBadLink",
      "Нужна ссылка на Google Таблицу (docs.google.com/spreadsheets/…)",
    );
  return url.trim();
}

/** Предпросмотр таблицы: сколько позиций добавится, пропадёт, сменит цену. Ничего не пишет. */
export async function previewPricelistSheetFor(
  ctx: TenantContext,
  url: string,
  fetchImpl?: FetchLike,
) {
  requirePricelist(ctx);
  return previewPricelistSheet(ctx, requireSheetLink(url), fetchImpl);
}

/** Загрузить таблицу после предпросмотра и обновлять из неё прайс автоматически. */
export async function importPricelistSheetFor(
  ctx: TenantContext,
  url: string,
  fingerprint: string,
  fetchImpl?: FetchLike,
) {
  requirePricelist(ctx);
  return importPricelistSheet(ctx, requireSheetLink(url), fingerprint, fetchImpl);
}

export async function disconnectPricelistSheetFor(ctx: TenantContext) {
  requirePricelist(ctx);
  await disconnectPricelistSheet(ctx);
  return { ok: true };
}

const DOC_FAILURE: Record<DocumentTextFailure, [string, string]> = {
  empty: ["err.pricelist.kbEmptyFile", "В файле нет текста."],
  pdfScan: [
    "err.pricelist.kbPdfScan",
    "В этом PDF нет текстового слоя — похоже, это скан. Пришлите PDF, из которого текст можно выделить мышью, или вставьте текст.",
  ],
  pdfBroken: ["err.pricelist.kbPdfBroken", "Не удалось прочитать PDF."],
  docxBroken: ["err.pricelist.kbDocxBroken", "Не удалось прочитать документ Word."],
  oldDoc: [
    "err.pricelist.kbOldDoc",
    "Это старый формат Word (.doc). Сохраните документ как .docx или PDF и загрузите снова.",
  ],
};

/**
 * Предпросмотр загрузки в базу знаний: файл PDF, Word (.docx), .txt/.md или
 * вставленный текст → статьи. Ничего не пишет: продавец видит статьи, отмечает
 * нужные и только потом добавляет их (addKnowledgeArticles).
 */
export async function previewKnowledgeImport(
  ctx: TenantContext,
  input: { text: string } | { fileName: string; base64: string },
) {
  requirePricelist(ctx);
  let text: string;
  let fileName: string | undefined;
  if ("text" in input) text = input.text;
  else {
    const { decodeBase64, extractDocumentText } =
      await import("@/core/consultant/pricelist/doc-text");
    const bytes = decodeBase64(input.base64);
    if (bytes.length > KNOWLEDGE_FILE_MAX_MB * 1024 * 1024)
      throw new UserError(
        "err.pricelist.kbFileTooBig",
        "Файл больше {mb} МБ — разделите его на части или вставьте текст.",
        { mb: KNOWLEDGE_FILE_MAX_MB },
      );
    const r = await extractDocumentText(bytes, input.fileName);
    if (!r.ok) {
      const [key, ru] = DOC_FAILURE[r.error];
      throw new UserError(key, ru);
    }
    text = r.text;
    fileName = input.fileName;
  }
  const { articles, truncated } = articlesFromText(text, fileName);
  if (articles.length === 0)
    throw new UserError(
      "err.pricelist.kbNoArticles",
      "Не удалось выделить статьи. Разделяйте статьи строкой ### или ---, первая строка — заголовок.",
    );
  const existing = await loadKnowledge(ctx);
  return {
    articles: previewMerge(existing, articles),
    truncated,
    maxChars: KNOWLEDGE_ARTICLE_MAX_CHARS,
  };
}

/** Добавить отмеченные статьи из предпросмотра: прежние статьи остаются, тот же заголовок — обновляется. */
export async function addKnowledgeArticles(ctx: TenantContext, articles: ImportedArticle[]) {
  requirePricelist(ctx);
  const clean = articles
    .map((a) => ({
      title: a.title.trim().slice(0, 200),
      tags: a.tags
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      content: a.content.trim().slice(0, KNOWLEDGE_ARTICLE_MAX_CHARS),
    }))
    .filter((a) => a.title && a.content);
  if (clean.length === 0)
    throw new UserError("err.pricelist.kbNothingChosen", "Отметьте хотя бы одну статью.");
  return appendKnowledge(ctx, clean);
}

export async function savePricelistSettings(
  ctx: TenantContext,
  data: {
    synonyms: string;
    shopUrl: string;
    store: StoreInfo;
    followUp?: boolean;
    qualityDigest?: boolean;
    /** Рабочие часы консультанта (нерабочее время — «менеджер ответит утром»). */
    hours?: ShopHours;
  },
) {
  requirePricelist(ctx);
  const url = data.shopUrl.trim();
  if (url && !/^https:\/\/[^\s/]+/i.test(url))
    throw new UserError("err.pricelist.badUrl", "Адрес сайта должен начинаться с https://");
  const h = data.hours;
  // Открытие 0–23, закрытие 1–24 и не совпадают; 0–24 — консультант без нерабочего времени.
  const hour = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (h && (!hour(h.open, 0, 23) || !hour(h.close, 1, 24) || h.open === h.close))
    throw new UserError(
      "err.pricelist.badHours",
      "Часы работы: открытие с 0 до 23, закрытие с 1 до 24, и они не совпадают.",
    );
  await saveSynonyms(ctx, data.synonyms);
  await setSetting(ctx, SHOP_URL_KEY, url);
  await saveStoreInfo(ctx, data.store);
  if (data.followUp !== undefined)
    await setSetting(ctx, FOLLOW_UP_SETTING_KEY, data.followUp ? "on" : "off");
  if (data.qualityDigest !== undefined)
    await setSetting(ctx, DIGEST_SETTING_KEY, data.qualityDigest ? "on" : "off");
  // Часы пишутся, только если поменялись: не тронутые часы BOVI остаются «по умолчанию».
  const cur = pricelistHours(ctx.tenant);
  if (h && (h.open !== cur.open || h.close !== cur.close))
    await patchSettings(ctx.tenant.id, {
      consultant_pricelist: { hours: { open: h.open, close: h.close } },
    });
  return { ok: true };
}

/**
 * Образ консультанта: название, о магазине, тон, особенности товаров. null
 * или текст BOVI без правок — настройка убирается, подсказка BOVI прежняя.
 */
export async function savePricelistPersona(
  ctx: TenantContext,
  persona: PricelistPersona | null,
): Promise<{ custom: boolean }> {
  requirePricelist(ctx);
  const clean = persona ? cleanPersona(persona) : undefined;
  if (persona && !clean) throw new UserError("err.pricelist.noBrand", "Укажите название магазина.");
  const value = clean && !isDefaultPersona(clean) ? clean : null;
  await patchSettings(ctx.tenant.id, { consultant_pricelist: { persona: value } });
  return { custom: value !== null };
}

/**
 * Задачи консультанта: каждая передача менеджеру (core/consultant/tasks). У
 * каждой — id диалога во «Входящих» (`telegramId` покупателя): переход в
 * диалог внутри панели, а не наружу в ig.me/t.me. Покупателя нет — null.
 */
export async function consultantTasks(ctx: TenantContext) {
  requirePricelist(ctx);
  const tasks = await loadTasks(ctx);
  const { inChunks } = await import("@/lib/in-chunks");
  const rows = await inChunks(
    tasks.map((t) => t.userKey),
    (chunk) => ctx.db.from("bot_users").select("user_key, telegram_id").in("user_key", chunk),
    "задачи консультанта: покупатели",
  );
  const ids = new Map(rows.map((r) => [r.user_key, r.telegram_id]));
  return {
    tasks: tasks.map((t) => ({ ...t, telegramId: ids.get(t.userKey) ?? null })),
    open: tasks.filter((t) => !t.done).length,
  };
}

export async function markConsultantTask(ctx: TenantContext, id: string, done: boolean) {
  requirePricelist(ctx);
  if (!(await setTaskDone(ctx, id, done)))
    throw new UserError("err.pricelist.noTask", "Задачи уже нет в списке — обновите страницу.");
  return { ok: true };
}

export async function clearConsultantTasks(ctx: TenantContext, which: "done" | "all") {
  requirePricelist(ctx);
  return clearTasks(ctx, which);
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
  await updateProductMedia(ctx, (list) => [...list.filter((m) => m.id !== item.id), item]);
  return item;
}

/** Убрать файл из фотобазы; сам файл удаляется из бакета, если он этого магазина. */
export async function deleteProductMedia(ctx: TenantContext, id: string) {
  requirePricelist(ctx);
  let gone: ProductMedia | undefined;
  await updateProductMedia(ctx, (list) => {
    gone = list.find((m) => m.id === id);
    return gone ? list.filter((m) => m.id !== id) : null;
  });
  if (gone?.path.startsWith(`${ctx.tenant.id}/`)) {
    const { serviceDb } = await import("@/core/db/client.server");
    await serviceDb()
      .storage.from("product-images")
      .remove([gone.path])
      .catch(() => null);
  }
  return { ok: true };
}

type ArticleInput = { id?: string; title: string; tags?: string[]; content: string };

function cleanArticle(a: ArticleInput, id: string, now: Date): ConsultantKnowledgeArticle {
  return {
    id,
    title: a.title.trim().slice(0, 200),
    tags: (a.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20),
    content: a.content.trim().slice(0, 30_000),
    updatedAt: now.toISOString(),
  };
}

/** Дата «обновлено» меняется только у статьи, которую правда изменили. */
function keepDate(
  next: ConsultantKnowledgeArticle,
  prev: ConsultantKnowledgeArticle | undefined,
): ConsultantKnowledgeArticle {
  const same =
    prev &&
    prev.title === next.title &&
    prev.content === next.content &&
    prev.tags.join("\u0000") === next.tags.join("\u0000");
  return same ? { ...next, updatedAt: prev.updatedAt } : next;
}

/** Весь список статей (карточка «База знаний» на странице прайса). */
export async function savePricelistArticles(
  ctx: TenantContext,
  articles: ArticleInput[],
  now = new Date(),
) {
  requirePricelist(ctx);
  let count = 0;
  await changeKnowledge(ctx, (current) => {
    const byId = new Map(current.map((a) => [a.id, a]));
    const clean = articles
      .filter((a) => a.title.trim() && a.content.trim())
      .map((a, i) => {
        const next = cleanArticle(a, a.id?.trim() || `kb-${now.getTime().toString(36)}-${i}`, now);
        return keepDate(next, byId.get(next.id));
      });
    count = clean.length;
    return clean;
  });
  return { count };
}

/**
 * Одна статья со страницы «База знаний»: остальные берутся из базы в момент
 * записи, а не со страницы. Статьи с таким id нет (удалили в другой вкладке)
 * — сохраняется как новая, текст продавца не пропадает.
 */
export async function savePricelistArticle(
  ctx: TenantContext,
  article: ArticleInput,
  now = new Date(),
): Promise<{ id: string }> {
  requirePricelist(ctx);
  if (!article.title.trim() || !article.content.trim())
    throw new UserError("err.pricelist.kbEmpty", "У статьи должны быть название и текст.");
  const id =
    article.id?.trim() ||
    `kb-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await changeKnowledge(ctx, (current) => {
    const prev = current.find((a) => a.id === id);
    const next = keepDate(cleanArticle(article, id, now), prev);
    if (prev) return current.map((a) => (a.id === id ? next : a));
    if (current.length >= KNOWLEDGE_MAX_ARTICLES)
      throw new UserError(
        "err.pricelist.kbTooMany",
        "В базе знаний было бы {count} статей, а помещается {max}. Удалите лишние или объедините статьи.",
        { count: current.length + 1, max: KNOWLEDGE_MAX_ARTICLES },
      );
    return [...current, next];
  });
  return { id };
}

/** Удалить одну статью; остальные — как в базе в момент записи. */
export async function deletePricelistArticle(ctx: TenantContext, id: string) {
  requirePricelist(ctx);
  await changeKnowledge(ctx, (current) =>
    current.some((a) => a.id === id) ? current.filter((a) => a.id !== id) : null,
  );
  return { ok: true };
}
