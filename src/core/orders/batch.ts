import { loadOrderGift } from "@/core/orders/gift";
import { recordOrderEvent } from "@/core/orders/events";
import {
  ASSEMBLABLE_STATUSES,
  orderIdsForFilter,
  setPhysicalStatus,
  type OrderFilter,
} from "@/core/orders/admin";
import { buildPackingSlip, type PackingSlip } from "@/core/orders/packing-slip";
import type { OrderWithItems } from "@/core/orders/orders";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { BATCH_MAX } from "@/core/orders/batch-pure";
import { inChunks } from "@/lib/in-chunks";

/**
 * Сборка и печать пачкой (А16): выбранные заказы — листами упаковки, этикетками
 * доставки или отметкой «собрано». Печатаем не больше BATCH_MAX заказов за раз
 * (batch-pure): сверх — отказ с числом, а не тихая обрезка.
 */

export { BATCH_MAX };

/** «Отметить собранными»: общий бюджет работы одного вызова (в функции лимит 120 с). */
export const ASSEMBLE_BUDGET_MS = 90_000;

/** Кого брать: явный выбор или «все по фильтру» (id читаются постранично на сервере). */
export type BatchSelection = { ids?: number[]; filter?: OrderFilter };

export async function resolveSelection(
  ctx: TenantContext,
  sel: BatchSelection,
  now = new Date(),
): Promise<number[]> {
  const ids = sel.ids
    ? [...new Set(sel.ids)]
    : sel.filter
      ? await orderIdsForFilter(ctx, sel.filter, now)
      : [];
  return ids;
}

function assertPrintable(ids: number[]): void {
  if (ids.length > BATCH_MAX)
    throw new UserError(
      "err.batch.tooMany",
      "Выбрано {n} заказов, за раз печатается не больше {max}. Уточните фильтр или выберите меньше.",
      { n: ids.length, max: BATCH_MAX },
    );
}

/** Упаковочные листы (без цен — buildPackingSlip) в порядке выбора; исчезнувший заказ пропускаем. */
export async function packingSlips(
  ctx: TenantContext,
  sel: BatchSelection,
  now = new Date(),
): Promise<{ slips: PackingSlip[]; missing: number }> {
  const ids = await resolveSelection(ctx, sel, now);
  assertPrintable(ids);
  const slips: PackingSlip[] = [];
  let missing = 0;
  // По пять листов одновременно: быстрее, чем по одному, и не заваливает базу.
  for (let i = 0; i < ids.length; i += 5) {
    const part = await Promise.all(ids.slice(i, i + 5).map((id) => buildPackingSlip(ctx, id)));
    for (const s of part) {
      if (s) slips.push(s);
      else missing += 1;
    }
  }
  return { slips, missing };
}

export type DeliveryLabel = {
  orderNo: number;
  name: string;
  phone: string;
  address: string;
  /** День доставки (ISO, полночь UTC) или null. */
  date: string | null;
  /** Подарок: кому вручить. */
  recipient: string;
};

/**
 * Этикетки доставки — только по заказам с доставкой; самовывоз и заказы без
 * адреса считаем отдельно (`skipped`), чтобы продавец видел, что не напечатано.
 */
export async function deliveryLabels(
  ctx: TenantContext,
  sel: BatchSelection,
  now = new Date(),
): Promise<{ labels: DeliveryLabel[]; skipped: number }> {
  const ids = await resolveSelection(ctx, sel, now);
  assertPrintable(ids);
  const rows = await readOrders(ctx, ids);
  const byId = new Map(rows.map((o) => [o.id, o]));
  const labels: DeliveryLabel[] = [];
  let skipped = 0;
  for (const id of ids) {
    const o = byId.get(id);
    if (!o || o.fulfillment_type !== "delivery" || !o.fulfillment_address?.trim()) {
      skipped += 1;
      continue;
    }
    const gift = await loadOrderGift(ctx, id);
    labels.push({
      orderNo: Number(o.display_no ?? o.order_no ?? o.id),
      name: o.display_name ?? "",
      phone: o.contact ?? "",
      address: o.fulfillment_address.trim(),
      date: o.fulfillment_at ?? null,
      recipient: gift?.recipient ?? "",
    });
  }
  return { labels, skipped };
}

async function readOrders(ctx: TenantContext, ids: number[]): Promise<OrderWithItems[]> {
  return (await inChunks(
    ids,
    (chunk) => ctx.db.from("orders").select("*, order_items(*)").in("id", chunk),
    "Заказы пачкой",
  )) as unknown as OrderWithItems[];
}

export type AssembleResult = {
  /** Сколько заказов этот вызов перевёл в «готов». */
  assembled: number;
  /** Уже собраны или выданы — в том числе другим кликом в тот же момент. */
  already: number;
  /** Не подходят: не физические, ждут оплаты, отклонены, не найдены. */
  skipped: number;
  /** Уведомление покупателю не дошло (статус при этом сменён). */
  notNotified: number;
  /** Не успели за бюджет времени — нажмите ещё раз, обработанные не тронутся. */
  remaining: number;
};

/**
 * «Отметить собранными»: принят/в работе → готов. Каждый заказ переводится
 * условной записью по его статусу: двойной клик или два окна не дадут второго
 * перехода, а покупателю напишет только тот вызов, чья запись сработала.
 * Меняются только выбранные заказы. Уведомление — колбэк слоя приложения
 * (ядро каналов не знает).
 */
export async function assembleOrders(
  ctx: TenantContext,
  sel: BatchSelection,
  actor: string,
  notify: (order: OrderWithItems) => Promise<boolean>,
  opts: { now?: Date; budgetMs?: number; clock?: () => number } = {},
): Promise<AssembleResult> {
  const ids = await resolveSelection(ctx, sel, opts.now);
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + (opts.budgetMs ?? ASSEMBLE_BUDGET_MS);
  const out: AssembleResult = {
    assembled: 0,
    already: 0,
    skipped: 0,
    notNotified: 0,
    remaining: 0,
  };
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const part = ids.slice(i, i + BATCH_MAX);
    const byId = new Map((await readOrders(ctx, part)).map((o) => [o.id, o]));
    for (let j = 0; j < part.length; j++) {
      if (clock() > deadline) {
        out.remaining += part.length - j;
        break;
      }
      const o = byId.get(part[j]!);
      if (!o || o.fulfillment_kind !== "physical") {
        out.skipped += 1;
      } else if (o.status === "ready" || o.status === "delivered") {
        out.already += 1;
      } else if (!(ASSEMBLABLE_STATUSES as readonly string[]).includes(o.status)) {
        out.skipped += 1;
      } else if (!(await setPhysicalStatus(ctx, o.id, o.status, "ready"))) {
        // Статус поменяли между чтением и записью: условная запись не сработала.
        out.already += 1;
      } else {
        out.assembled += 1;
        await recordOrderEvent(ctx, o.id, "status", { to: "ready", batch: true }, actor);
        const sent = await notify({ ...o, status: "ready" }).catch((e) => {
          console.error(`[orders] сборка пачкой, заказ #${o.id}: ${String(e)}`);
          return false;
        });
        if (!sent) out.notNotified += 1;
      }
    }
    if (out.remaining) out.remaining += ids.length - i - part.length;
    if (out.remaining) break;
  }
  return out;
}
