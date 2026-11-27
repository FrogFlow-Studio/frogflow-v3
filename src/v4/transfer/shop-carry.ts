import type { V4Db } from "../core/db";
import { completeLesson, noteVipCount, stocktake } from "../core/platform";

/**
 * Вторая опись переноса. Склад и VIP пишутся в v4. Открытые заказы, скидки,
 * история рассылок и файлы кабинета не копируются: повтор отправил бы
 * оплату и письма второй раз. Пустая область тоже оставляет строку
 * «проверить», чтобы ни одна не пропала молча. public не пишется.
 */

export const CARRY_AREAS = [
  "orders",
  "stock",
  "discounts",
  "students",
  "vip",
  "broadcasts",
  "cabinet",
] as const;

export type CarryArea = (typeof CARRY_AREAS)[number];

export type CarryLine = {
  area: CarryArea;
  action: "carry" | "check";
  item: string;
  reason: string;
};

export type ShopSnapshot = {
  openOrders: { id: string }[];
  stock: { productId: string; onHand: number }[];
  discounts: { id: string }[];
  students: { buyerId: string; lessonId: string }[];
  vip: { chatId: string; count: number }[];
  broadcasts: { id: string }[];
  cabinetFiles: { id: string }[];
};

const REASON = {
  orders: "открытый заказ не копируется, чтобы не задвоить оплату",
  discounts: "скидка не стала ценой v4",
  broadcasts: "история не ставится в очередь повторно",
  cabinet: "файл остаётся в хранилище v3",
} as const;

function linesOf(
  area: CarryArea,
  items: string[],
  action: CarryLine["action"],
  reason: string,
): CarryLine[] {
  if (items.length === 0)
    return [{ area, action: "check", item: area, reason: `пусто: ${reason}` }];
  return items.map((item) => ({ area, action, item, reason }));
}

/** План без записи: что перенести и что только проверить. */
export function planShopCarry(s: ShopSnapshot): CarryLine[] {
  const vipReason =
    s.vip.length > 1 ? "в v4 одна группа на магазин, лишние только в отчёте" : "снимок числа людей";
  return [
    ...linesOf(
      "orders",
      s.openOrders.map((o) => o.id),
      "check",
      REASON.orders,
    ),
    ...linesOf(
      "stock",
      s.stock.map((x) => x.productId),
      "carry",
      "остаток инвентаризацией, повтор с тем же ключом не двигает склад",
    ),
    ...linesOf(
      "discounts",
      s.discounts.map((d) => d.id),
      "check",
      REASON.discounts,
    ),
    ...linesOf(
      "students",
      s.students.map((x) => `${x.buyerId}:${x.lessonId}`),
      "carry",
      "урок отмечается пройденным, если доступ уже есть",
    ),
    ...linesOf(
      "vip",
      s.vip.map((v) => v.chatId),
      s.vip.length > 1 ? "check" : "carry",
      vipReason,
    ),
    ...linesOf(
      "broadcasts",
      s.broadcasts.map((b) => b.id),
      "check",
      REASON.broadcasts,
    ),
    ...linesOf(
      "cabinet",
      s.cabinetFiles.map((f) => f.id),
      "check",
      REASON.cabinet,
    ),
  ];
}

export type CarryReport = { carried: number; checks: CarryLine[] };

/**
 * Применить опись. Повтор безопасен: инвентаризация с тем же ключом при
 * том же остатке пишет ноль, урок второй раз не вставляется.
 */
export async function applyShopCarry(
  db: V4Db,
  botId: string,
  s: ShopSnapshot,
): Promise<CarryReport> {
  const checks: CarryLine[] = [];
  let carried = 0;
  for (const line of planShopCarry(s)) if (line.action === "check") checks.push(line);

  for (const row of s.stock) {
    const r = await stocktake(db, {
      botId,
      productId: row.productId,
      target: row.onHand,
      externalRef: `v3-stock:${row.productId}`,
      by: "transfer",
    });
    if (!r.ok) checks.push({ area: "stock", action: "check", item: row.productId, reason: r.code });
    else carried += 1;
  }

  for (const row of s.students) {
    const r = await completeLesson(db, { botId, buyerId: row.buyerId, lessonId: row.lessonId });
    if (!r.ok) {
      checks.push({
        area: "students",
        action: "check",
        item: row.lessonId,
        reason: r.code === "no_access" ? "доступа к курсу нет, урок не отмечен" : r.code,
      });
    } else if (r.value) carried += 1;
  }

  const vip = s.vip[0];
  if (vip && s.vip.length === 1) {
    const r = await noteVipCount(db, { botId, chatId: vip.chatId, count: vip.count });
    if (!r.ok) checks.push({ area: "vip", action: "check", item: vip.chatId, reason: r.code });
    else carried += 1;
  }
  return { carried, checks };
}
