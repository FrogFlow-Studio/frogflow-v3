import { withoutCourseMarker } from "@/core/courses/marker";
import { createHash } from "node:crypto";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { MaterialSnapshot } from "@/core/catalog/materials";
import { serviceDb } from "@/core/db/client.server";
import { isDeliverableStorageKey, isTenantStorageKey } from "@/core/storage/keys";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { reportError } from "@/lib/errors";
import {
  copyAgeDays,
  isPdfMaterial,
  isStampedCopyKey,
  STAMP_REUSE_DAYS,
  staleStampedCopies,
  watermarkLine,
  type WatermarkBuyer,
} from "./watermark";
import { serverFailure } from "@/lib/server-failure";

const BUCKET = "product-files";
/** Больше — отдаём без знака: функция не должна держать в памяти огромный файл. */
const MAX_BYTES = 50 * 1024 * 1024;

/** Включён ли знак у магазина (`bots.settings.delivery.pdf_watermark`). */
export function watermarkEnabled(ctx: TenantContext): boolean {
  return ctx.tenant.settings.delivery?.pdf_watermark === true;
}

/** Ключ копии со знаком: одна на заказ и исходный файл, под префиксом клиента. */
export function stampedKey(tenantId: string, orderId: number, path: string): string {
  const h = createHash("sha256").update(path).digest("hex").slice(0, 16);
  return `${tenantId}/wm/${orderId}-${h}.pdf`;
}

/**
 * Знак на каждой странице: крупно и бледно по диагонали и мелкой строкой
 * внизу. Страницы не перерисовываются, файл остаётся текстовым.
 */
export async function stampPdf(bytes: Uint8Array, line: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    // Страница может начинаться не с нуля: отсчёт от её рамки.
    const { x: ox, y: oy, width, height } = page.getMediaBox();
    const big = Math.max(
      10,
      Math.min(36, (Math.hypot(width, height) * 0.8) / Math.max(1, line.length) / 0.55),
    );
    const w = font.widthOfTextAtSize(line, big);
    const a = Math.atan2(height, width);
    page.drawText(line, {
      x: ox + width / 2 - (w / 2) * Math.cos(a) + (big / 2) * Math.sin(a),
      y: oy + height / 2 - (w / 2) * Math.sin(a) - (big / 2) * Math.cos(a),
      size: big,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.15,
      rotate: degrees((a * 180) / Math.PI),
    });
    page.drawText(line, {
      x: ox + 16,
      y: oy + 10,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.4),
      opacity: 0.6,
    });
  }
  return doc.save();
}

type Order = WatermarkBuyer & { id: number; display_no?: number | null; order_no?: number | null };

/**
 * Материалы к выдаче. Через эту функцию проходят все выдачи (Telegram,
 * Instagram/WhatsApp, письмо, «Мои материалы»), поэтому здесь же отсекаем
 * ключ с префиксом другого клиента: строки заказов v1 и старые снимки
 * пишутся не через проверки v2, а подпись идёт под service_role. Такой файл
 * не подписывается: выдача по нему не пройдёт, и продавец увидит ошибку.
 *
 * У магазина со знаком каждый PDF из хранилища заменяется копией с именем
 * покупателя (готовая копия берётся повторно). Любая неудача знака —
 * исходный файл: покупатель заплатил и должен получить материал.
 */
export async function protectMaterials(
  ctx: TenantContext,
  order: Order,
  materials: MaterialSnapshot[],
): Promise<MaterialSnapshot[]> {
  // Метка товара-курса — не файл: вместо неё канал получает ссылку на уроки.
  materials = withoutCourseMarker(materials);
  const foreign = (m: MaterialSnapshot) =>
    Boolean(m.path) && !isDeliverableStorageKey(ctx.tenant.id, m.path!);
  if (materials.some(foreign)) {
    await reportError(new Error("чужой ключ в материалах заказа"), {
      where: "delivery.foreign_key",
      botId: ctx.tenant.id,
      extra: { orderId: order.id },
    });
    materials = materials.map((m) => (foreign(m) ? { ...m, path: null } : m));
  }
  if (!watermarkEnabled(ctx)) return materials;
  const out: MaterialSnapshot[] = [];
  for (const m of materials) {
    if (!m.path || m.url || !isPdfMaterial(m) || !isTenantStorageKey(ctx.tenant.id, m.path)) {
      out.push(m);
      continue;
    }
    const key = await stampedCopy(ctx, order, m.path).catch(async (e: unknown) => {
      await reportError(e, { where: "delivery.watermark", botId: ctx.tenant.id });
      return null;
    });
    out.push(key ? { ...m, path: key } : m);
  }
  return out;
}

async function stampedCopy(ctx: TenantContext, order: Order, path: string): Promise<string | null> {
  const bucket = serviceDb().storage.from(BUCKET);
  const key = stampedKey(ctx.tenant.id, order.id, path);
  // Свежая копия — та же; старая переписывается, чтобы не удалить её
  // чисткой, пока живёт новая ссылка (STAMP_REUSE_DAYS < STAMP_KEEP_DAYS).
  const have = await bucket.info(key);
  if (have.data) {
    const age = copyAgeDays(
      { updated_at: have.data.lastModified ?? null, created_at: have.data.createdAt ?? null },
      Date.now(),
    );
    if (age != null && age <= STAMP_REUSE_DAYS) return key;
  }
  const info = await bucket.info(path);
  if (!info.data || Number(info.data.size ?? 0) > MAX_BYTES) return null;
  const { data: file, error } = await bucket.download(path);
  if (error || !file) return null;
  const no = Number(order.display_no ?? order.order_no ?? order.id);
  const stamped = await stampPdf(
    new Uint8Array(await file.arrayBuffer()),
    watermarkLine(order, no),
  );
  const up = await bucket.upload(key, stamped, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`watermark upload: ${up.error.message}`);
  return key;
}

type Storage = Pick<ReturnType<typeof serviceDb>["storage"], "from">;
type Db = Pick<ReturnType<typeof serviceDb>, "from">;

/** Порция на клиента за проход: остаток заберёт следующий запуск. */
const PRUNE_LIST_LIMIT = 1000;
const REMOVE_CHUNK = 100;
/**
 * Ключей в одной проверке «не оригинал». Список уходит в адрес запроса
 * PostgREST (`in.(…)`), ключ ~70 знаков: 1000 ключей — около 70 КБ адреса,
 * такой запрос отвергается, и чистка не шла бы никогда.
 */
export const CHECK_CHUNK = 100;

/**
 * Ключи, на которые ссылаются как на оригинал: файлы товаров и снимки
 * файлов в заказах. Вторая защита поверх формата ключа — даже если такой
 * файл вдруг лежит в `wm/`, чистка его не тронет.
 */
async function referencedAsOriginal(db: Db, all: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < all.length; i += CHECK_CHUNK)
    await markReferenced(db, all.slice(i, i + CHECK_CHUNK), found);
  return found;
}

async function markReferenced(db: Db, keys: string[], found: Set<string>): Promise<void> {
  const checks = [
    db.from("product_material_files").select("file_path").in("file_path", keys),
    db.from("products").select("file_path").in("file_path", keys),
    db.from("products").select("file_path_kz").in("file_path_kz", keys),
    db.from("order_items").select("file_path_snapshot").in("file_path_snapshot", keys),
    db.from("order_items").select("file_path_kz_snapshot").in("file_path_kz_snapshot", keys),
  ];
  for (const q of checks) {
    const { data, error } = await q;
    if (error) throw serverFailure(`watermark prune check: ${error.message}`);
    for (const row of (data ?? []) as Array<Record<string, string | null>>)
      for (const v of Object.values(row)) if (v) found.add(v);
  }
}

/**
 * Чистка копий со знаком (крон retention): только клиенты из `tenantIds`
 * (клиенты v2 — правило 6; у клиентов прежней платформы копий нет, и их
 * хранилище v2 не трогает), только папка `<клиент>/wm/`, только ключи формата
 * stampedKey старше STAMP_KEEP_DAYS и не упомянутые как оригинал.
 */
export async function pruneStampedCopies(
  tenantIds: readonly string[],
  now = Date.now(),
  deps: { storage?: Storage; db?: Db } = {},
): Promise<{ deleted: number; done: boolean }> {
  const storage = deps.storage ?? serviceDb().storage;
  const db = deps.db ?? serviceDb();
  const bucket = storage.from(BUCKET);
  let deleted = 0;
  let done = true;
  for (const id of tenantIds) {
    const { data, error } = await bucket.list(`${id}/wm`, {
      limit: PRUNE_LIST_LIMIT,
      sortBy: { column: "updated_at", order: "asc" },
    });
    if (error) throw serverFailure(`watermark prune list ${id}: ${error.message}`);
    const stale = staleStampedCopies(id, data ?? [], now);
    const keep = await referencedAsOriginal(db, stale);
    const doomed = stale.filter((k) => !keep.has(k) && isStampedCopyKey(id, k));
    for (let i = 0; i < doomed.length; i += REMOVE_CHUNK) {
      const { error: e } = await bucket.remove(doomed.slice(i, i + REMOVE_CHUNK));
      if (e) throw serverFailure(`watermark prune remove ${id}: ${e.message}`);
    }
    deleted += doomed.length;
    // Полная страница и было что удалить — дальше могут быть ещё старые.
    // Без удалений повтор вернул бы ту же страницу и съел бюджет крона.
    if ((data ?? []).length >= PRUNE_LIST_LIMIT && doomed.length > 0) done = false;
  }
  return { deleted, done };
}
