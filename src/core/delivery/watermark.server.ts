import { createHash } from "node:crypto";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { MaterialSnapshot } from "@/core/catalog/materials";
import { serviceDb } from "@/core/db/client.server";
import { isTenantStorageKey } from "@/core/storage/keys";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { reportError } from "@/lib/errors";
import { isPdfMaterial, watermarkLine, type WatermarkBuyer } from "./watermark";

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
 * Материалы к выдаче: у магазина со знаком каждый PDF из хранилища заменяется
 * копией с именем покупателя (готовая копия берётся повторно). Любая
 * неудача — исходный файл: покупатель заплатил и должен получить материал.
 */
export async function protectMaterials(
  ctx: TenantContext,
  order: Order,
  materials: MaterialSnapshot[],
): Promise<MaterialSnapshot[]> {
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
  const have = await bucket.exists(key);
  if (have.data) return key;
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
