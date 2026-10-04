/**
 * Физический заказ в руках продавца: принять с записью задатка, внести
 * оплату вручную, завести заказ без бота, поправить получение. Канал не
 * знает ни одна из функций — админка и кнопки в Telegram зовут одно и то же.
 */
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  activeDeliveryZones,
  amountDueNow,
  decrementStock,
  recordPayment,
  restoreStock,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { recordStockChanges, type StockChange } from "@/core/catalog/stock-history";
import {
  addDaysToIso,
  fulfillmentTotalBelowPaid,
  fulfillmentTypePatch,
  remainingDueNow,
  todayInTz,
} from "@/core/fulfillment/pure";
import { recordOrderEvent } from "./events";
import { pageAll } from "@/core/db/page";
import {
  manualCustomerTelegramId,
  manualCustomerUserKey,
  manualOrderStatus,
  manualOrderTotal,
} from "./manual";

export type AcceptResult = { ok: boolean; alreadyAccepted: boolean; recorded: number };

/**
 * Принять физический заказ в работу. Если покупатель прислал чек
 * (awaiting_confirmation), продавец этим подтверждает деньги — пишется
 * положенная сейчас сумма (задаток или всё) за вычетом уже внесённого
 * вручную. Из awaiting_payment заказ принимается «на доверие»: чека нет,
 * платёж писать не в чем. Повторное нажатие (CAS не сошёлся) ничего не
 * дописывает — иначе задаток задвоился бы.
 */
export async function acceptPhysicalOrder(
  ctx: TenantContext,
  id: number,
  actor = "admin",
): Promise<AcceptResult> {
  const { data: order, error: orderError } = await ctx.db
    .from("orders")
    .select("status, total, paid_amount, fulfillment_kind, currency")
    .eq("id", id)
    .maybeSingle();
  if (orderError) throw serverFailure(`Заказ #${id} не прочитан: ${orderError.message}`);
  if (!order || order.fulfillment_kind !== "physical")
    return { ok: false, alreadyAccepted: false, recorded: 0 };
  if (order.status !== "awaiting_confirmation" && order.status !== "awaiting_payment")
    return { ok: false, alreadyAccepted: true, recorded: 0 };
  const { data: moved, error: movedError } = await ctx.db
    .from("orders")
    .update({ status: "accepted" })
    .eq("id", id)
    .eq("status", order.status)
    .select("id")
    .maybeSingle();
  // Сбой записи — не «уже принят»: продавец должен повторить, а не поверить, что всё сделано.
  if (movedError) throw serverFailure(`Заказ #${id} не принят: ${movedError.message}`);
  if (!moved) return { ok: false, alreadyAccepted: true, recorded: 0 };
  await recordOrderEvent(ctx, id, "status", { to: "accepted" }, actor);
  let recorded = 0;
  if (order.status === "awaiting_confirmation") {
    const due = remainingDueNow(
      await amountDueNow(ctx, { total: Number(order.total), fulfillment_kind: "physical" }),
      order.paid_amount,
    );
    if (due > 0) {
      if (await recordPayment(ctx, id, due)) {
        recorded = due;
        await recordOrderEvent(
          ctx,
          id,
          "payment",
          { amount: due, currency: order.currency, source: "deposit" },
          actor,
        );
      } else console.error(`[orders] задаток по #${id} не записан`);
    }
  }
  return { ok: true, alreadyAccepted: false, recorded };
}

/**
 * «Внести оплату»: остаток по задатку, наличные при выдаче. Только для
 * физических и не отклонённых заказов; сумма перепроверяется на сервере
 * против total − paid_amount, присланному числу не верим.
 */
export async function recordManualPayment(
  ctx: TenantContext,
  id: number,
  amount: number,
  actor = "admin",
): Promise<{ paid: number; total: number }> {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new UserError("err.orders.amountPositive", "Сумма должна быть больше нуля");
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("total, paid_amount, fulfillment_kind, status, currency")
    .eq("id", id)
    .maybeSingle();
  if (error) throw serverFailure(`Заказ #${id} не прочитан: ${error.message}`);
  if (!order) throw new UserError("err.orders.notFound", "Заказ не найден");
  if (order.status === "rejected" || order.status === "cancelled")
    throw new UserError(
      "err.orders.rejectedNoPayment",
      "Заказ отклонён — оплата по нему не принимается",
    );
  if (order.fulfillment_kind !== "physical")
    throw new UserError(
      "err.orders.manualPaymentPhysicalOnly",
      "Ручное внесение оплаты доступно только для физических заказов",
    );
  const remaining = Number(order.total) - (Number(order.paid_amount) || 0);
  if (amount > remaining + 0.01)
    throw new UserError(
      "err.orders.amountOverRemaining",
      "Сумма больше остатка: осталось внести {remaining}",
      {
        remaining: Math.max(0, remaining),
      },
    );
  if (!(await recordPayment(ctx, id, amount))) {
    // Пока проверяли остаток, по заказу успели внести другой платёж.
    const { data: fresh, error: freshError } = await ctx.db
      .from("orders")
      .select("total, paid_amount")
      .eq("id", id)
      .maybeSingle();
    if (freshError) throw serverFailure(`Заказ #${id} не перечитан: ${freshError.message}`);
    const left = fresh ? Number(fresh.total) - (Number(fresh.paid_amount) || 0) : remaining;
    if (amount > left + 0.01)
      throw new UserError(
        "err.orders.amountOverRemaining",
        "Сумма больше остатка: осталось внести {remaining}",
        { remaining: Math.max(0, left) },
      );
    throw new UserError(
      "err.orders.paymentNotSaved",
      "Не удалось записать платёж, попробуйте ещё раз",
    );
  }
  await recordOrderEvent(ctx, id, "payment", { amount, currency: order.currency }, actor);
  // Деньги пришли по заказу, который ещё ждал оплату, — он в работе.
  if (order.status === "awaiting_payment" || order.status === "awaiting_confirmation") {
    const { data: moved, error: movedError } = await ctx.db
      .from("orders")
      .update({ status: "accepted" })
      .eq("id", id)
      .eq("status", order.status)
      .select("id")
      .maybeSingle();
    // Платёж уже записан: сбой смены статуса не отменяет его, продавец примет заказ вручную.
    if (movedError)
      console.error(`[orders] заказ #${id} не принят после оплаты: ${movedError.message}`);
    if (moved) await recordOrderEvent(ctx, id, "status", { to: "accepted" }, actor);
  }
  return {
    paid: Math.min(Number(order.total), (Number(order.paid_amount) || 0) + amount),
    total: Number(order.total),
  };
}

/** Самая ранняя дата получения с учётом срока изготовления, в поясе магазина. */
export function minFulfillmentDate(ctx: TenantContext, leadDays: number, now = new Date()): string {
  return addDaysToIso(todayInTz(ctx.timezone, now), Math.max(0, leadDays));
}

async function resolveZone(
  ctx: TenantContext,
  zoneId: string,
  countryCode: string | null,
): Promise<{ id: string; name: string; price: number; currency: string }> {
  const zone = (await activeDeliveryZones(ctx)).find((z) => z.id === zoneId);
  if (!zone) throw new UserError("err.orders.zoneNotFound", "Зона доставки не найдена");
  const fee = await zoneFee(ctx, zone.price, countryCode);
  return { id: zone.id, name: zone.name, price: fee.amount, currency: fee.currency };
}

export type ManualOrderProduct = {
  id: string;
  name: string;
  price: number;
  currency: string;
  leadDays: number;
  stock: number | null;
  variants: Array<{ id: string; name: string; price: number }>;
};

/**
 * Физические товары для формы ручного заказа. PostgREST отдаёт не больше
 * 1000 строк за запрос, поэтому читаем постранично; порядок заканчивается
 * уникальным id — иначе на стыке страниц товары с одинаковым порядком и
 * названием могли бы задвоиться или пропасть.
 */
export async function manualOrderProducts(ctx: TenantContext): Promise<ManualOrderProduct[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("products")
        .select(
          "id, name, price, currency, lead_time_days, stock_quantity, product_variants(id, name, price, sort_order)",
        )
        .eq("is_active", true)
        .eq("fulfillment_kind", "physical")
        .order("sort_order")
        .order("name")
        .order("id")
        .range(from, to),
    "products",
  );
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    currency: p.currency,
    leadDays: Number(p.lead_time_days) || 0,
    stock: ctx.tenant.modules.stock ? p.stock_quantity : null,
    variants: [...(p.product_variants ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({ id: v.id, name: v.name, price: Number(v.price) })),
  }));
}

export type ManualOrderInput = {
  displayName: string;
  contact: string | null;
  items: Array<{ productId: string; variantId: string | null; quantity: number }>;
  fulfillmentType: "pickup" | "delivery";
  fulfillmentAt: string | null;
  address: string | null;
  note: string | null;
  deliveryZoneId: string | null;
  paidAmount: number;
};

type ManualLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
  name: string;
  unit: number;
  currency: string;
};

/**
 * Завести заказ вручную: звонок, комментарий в Instagram, человек без бота.
 * Только физические товары — цифровой заказ выдаётся в чат, а у ручного
 * покупателя чата нет. Цена — базовая цена товара или варианта, дата не
 * раньше срока изготовления, остаток списывается так же, как в чекауте.
 * Внесённая сумма пишется сразу: есть деньги — заказ в работе, нет — ждёт
 * оплату. platform = manual: ночная чистка такие заказы не удаляет.
 */
export async function createManualOrder(
  ctx: TenantContext,
  input: ManualOrderInput,
  actor = "admin",
): Promise<{ id: number; orderNo: number }> {
  if (input.items.length === 0)
    throw new UserError("err.orders.noItems", "Добавьте хотя бы одну позицию");
  if (input.fulfillmentType === "delivery" && !input.deliveryZoneId) {
    const zones = await activeDeliveryZones(ctx);
    if (zones.length > 0)
      throw new UserError("err.orders.deliveryZoneRequired", "Для доставки выберите зону");
  }
  const productIds = [...new Set(input.items.map((it) => it.productId))];
  const { data: products, error: prodErr } = await ctx.db
    .from("products")
    .select("id, name, price, currency, is_active, fulfillment_kind, lead_time_days")
    .in("id", productIds);
  if (prodErr) throw serverFailure(prodErr.message);
  const { data: variants, error: variantsErr } = await ctx.db
    .from("product_variants")
    .select("id, product_id, name, price")
    .in("product_id", productIds);
  if (variantsErr) throw serverFailure(variantsErr.message);
  const byId = new Map((products ?? []).map((p) => [p.id, p]));

  const lines: ManualLine[] = [];
  let leadDays = 0;
  for (const it of input.items) {
    const p = byId.get(it.productId);
    if (!p || !p.is_active)
      throw new UserError("err.orders.productUnavailable", "Товар не найден или скрыт");
    if (p.fulfillment_kind !== "physical")
      throw new UserError(
        "err.orders.digitalProduct",
        "«{name}» — цифровой товар; вручную заводятся только физические заказы",
        { name: p.name },
      );
    const own = (variants ?? []).filter((v) => v.product_id === p.id);
    let unit = Number(p.price) || 0;
    let name = p.name;
    if (own.length > 0) {
      const v = own.find((row) => row.id === it.variantId);
      if (!it.variantId)
        throw new UserError("err.orders.variantRequired", "Выберите вариант для «{name}»", {
          name: p.name,
        });
      if (!v)
        throw new UserError("err.orders.variantNotFound", "Вариант не найден для «{name}»", {
          name: p.name,
        });
      unit = Number(v.price) || 0;
      name = `${p.name} — ${v.name}`;
    } else if (it.variantId)
      throw new UserError("err.orders.noVariants", "У «{name}» нет вариантов", { name: p.name });
    leadDays = Math.max(leadDays, Number(p.lead_time_days) || 0);
    lines.push({
      productId: p.id,
      variantId: it.variantId,
      quantity: it.quantity,
      name,
      unit,
      currency: p.currency || "KZT",
    });
  }
  const currency = lines[0]!.currency;
  if (lines.some((l) => l.currency !== currency))
    throw new UserError("err.orders.mixedCurrency", "Все позиции должны быть в одной валюте");

  if (input.fulfillmentAt && leadDays > 0) {
    const minIso = minFulfillmentDate(ctx, leadDays);
    if (input.fulfillmentAt < minIso)
      throw new UserError(
        "err.orders.dateTooEarly",
        "Слишком ранняя дата получения — срок изготовления {days} дн., доступно с {date}",
        { days: leadDays, date: minIso },
      );
  }

  const zone =
    input.fulfillmentType === "delivery" && input.deliveryZoneId
      ? await resolveZone(ctx, input.deliveryZoneId, null)
      : null;
  if (zone && zone.currency !== currency)
    throw new UserError(
      "err.orders.zoneCurrency",
      "Зона доставки в {zoneCurrency}, а товары в {currency}",
      {
        zoneCurrency: zone.currency,
        currency,
      },
    );
  const deliveryFee = zone?.price ?? 0;
  const total = manualOrderTotal(
    lines.map((l) => l.unit * l.quantity),
    deliveryFee,
  );
  const paid = Number(input.paidAmount) || 0;
  if (paid < 0)
    throw new UserError("err.orders.paidNegative", "Внесённая сумма не может быть отрицательной");
  if (paid > total + 0.01)
    throw new UserError("err.orders.paidOverTotal", "Внесено больше итога заказа ({total})", {
      total,
    });

  const reserved: Array<{ productId: string; qty: number }> = [];
  const stockChanges: StockChange[] = [];
  try {
    if (ctx.tenant.modules.stock) {
      for (const l of lines) {
        if (!(await decrementStock(ctx, l.productId, l.quantity, stockChanges)))
          throw new UserError("err.orders.outOfStock", "Недостаточно «{name}» на складе", {
            name: l.name,
          });
        reserved.push({ productId: l.productId, qty: l.quantity });
      }
    }
    const entropy = randomUUID();
    const { data: order, error } = await ctx.db
      .from("orders")
      .insert({
        bot_id: ctx.tenant.id,
        telegram_id: manualCustomerTelegramId(input.contact, entropy),
        user_key: manualCustomerUserKey(input.contact, entropy),
        platform: "manual",
        display_name: input.displayName,
        contact: input.contact,
        username: null,
        total,
        currency,
        status: manualOrderStatus(paid),
        paid_amount: Math.min(paid, total),
        admin_note: "Создан вручную",
        fulfillment_kind: "physical",
        fulfillment_type: input.fulfillmentType,
        fulfillment_at: input.fulfillmentAt ? `${input.fulfillmentAt}T00:00:00Z` : null,
        fulfillment_address: input.fulfillmentType === "delivery" ? input.address : null,
        fulfillment_note: input.note,
        delivery_zone_id: zone?.id ?? null,
        delivery_zone_name: zone?.name ?? null,
        delivery_fee: deliveryFee,
      })
      .select("id, order_no, display_no")
      .single();
    if (error) throw new Error(error.message);
    if (!order) throw new UserError("err.orders.createFailed", "Не удалось создать заказ");
    const { error: itemsError } = await ctx.db.from("order_items").insert(
      lines.map((l) => ({
        bot_id: ctx.tenant.id,
        order_id: order.id,
        product_id: l.productId,
        product_variant_id: l.variantId,
        name_snapshot: l.name,
        price_snapshot: l.unit,
        quantity: l.quantity,
      })),
    );
    if (itemsError) {
      await ctx.db.from("orders").delete().eq("id", order.id);
      throw serverFailure(itemsError.message);
    }
    await recordOrderEvent(ctx, order.id, "placed", { platform: "manual", total, currency }, actor);
    await recordStockChanges(ctx, stockChanges, {
      reason: "manual_order",
      orderId: order.id,
      actor,
    });
    if (paid > 0)
      await recordOrderEvent(ctx, order.id, "payment", { amount: paid, currency }, actor);
    return { id: order.id, orderNo: Number(order.display_no ?? order.order_no) };
  } catch (e) {
    for (const r of reserved) await restoreStock(ctx, r.productId, r.qty).catch(() => {});
    throw e;
  }
}

export type FulfillmentEdit = {
  id: number;
  fulfillmentAt: string | null;
  address: string | null;
  note: string | null;
  fulfillmentType?: "pickup" | "delivery" | null;
  deliveryZoneId?: string | null;
  /** Слот «10:00–12:00» из списка магазина; null — только дата (core/fulfillment/slots). */
  slot?: string | null;
};

/**
 * Поправить получение: покупательница позвонила перенести на субботу.
 * Дата, адрес и комментарий деньги не трогают; смена доставки ↔
 * самовывоза пересчитывает комиссию (fulfillmentTypePatch). Флаг
 * напоминания сбрасывается всегда: иначе после переноса даты напоминание
 * за сутки не пришло бы уже никогда.
 */
export async function updateOrderFulfillment(
  ctx: TenantContext,
  input: FulfillmentEdit,
  actor = "admin",
): Promise<void> {
  const { data: order, error: readErr } = await ctx.db
    .from("orders")
    .select(
      "fulfillment_kind, fulfillment_type, fulfillment_at, delivery_fee, total, paid_amount, country_code, status, order_items(products(lead_time_days))",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw serverFailure(readErr.message);
  if (!order) throw new UserError("err.orders.notFound", "Заказ не найден");
  if (order.fulfillment_kind !== "physical")
    throw new UserError(
      "err.orders.fulfillmentPhysicalOnly",
      "Способ получения правится только у физического заказа",
    );
  if (order.status === "delivered" || order.status === "rejected")
    throw new UserError("err.orders.closed", "Заказ уже закрыт");
  const newDay = input.fulfillmentAt;
  const oldDay = order.fulfillment_at ? String(order.fulfillment_at).slice(0, 10) : null;
  if (newDay && newDay !== oldDay) {
    const items = (order.order_items ?? []) as Array<{
      products?: { lead_time_days?: number | null } | null;
    }>;
    const leadDays = Math.max(0, ...items.map((it) => Number(it.products?.lead_time_days) || 0));
    const minIso = minFulfillmentDate(ctx, leadDays);
    if (newDay < minIso) {
      if (leadDays > 0)
        throw new UserError(
          "err.orders.dateTooEarly",
          "Слишком ранняя дата получения — срок изготовления {days} дн., доступно с {date}",
          { days: leadDays, date: minIso },
        );
      throw new UserError(
        "err.orders.datePassed",
        "Дата получения уже прошла — доступно с {date}",
        {
          date: minIso,
        },
      );
    }
  }
  let zone: { id: string; name: string; price: number } | null = null;
  if (input.fulfillmentType === "delivery" && input.deliveryZoneId) {
    zone = await resolveZone(ctx, input.deliveryZoneId, order.country_code);
  } else if (input.fulfillmentType === "delivery" && order.fulfillment_type !== "delivery") {
    const zones = await activeDeliveryZones(ctx);
    if (zones.length > 0) throw new UserError("err.orders.pickZone", "Выберите зону доставки");
  }
  const typePatch = fulfillmentTypePatch(
    {
      fulfillment_type: order.fulfillment_type,
      delivery_fee: order.delivery_fee,
      total: Number(order.total),
    },
    input.fulfillmentType,
    zone,
  );
  if (fulfillmentTotalBelowPaid(typePatch, Number(order.paid_amount) || 0))
    throw new UserError(
      "err.orders.feeBelowPaid",
      "Нельзя снять комиссию доставки — заказ уже оплачен на большую сумму. Сначала верните разницу покупателю.",
    );
  const nextType = typePatch.fulfillment_type ?? order.fulfillment_type;
  const { fulfillmentAtValue, fulfillmentSlots, withSlot } =
    await import("@/core/fulfillment/slots");
  const slots = await fulfillmentSlots(ctx);
  const { error } = await ctx.db
    .from("orders")
    .update({
      fulfillment_at: newDay ? fulfillmentAtValue(withSlot(newDay, input.slot), slots) : null,
      fulfillment_address: nextType === "delivery" ? input.address : null,
      fulfillment_note: input.note,
      fulfillment_reminder_sent_at: null,
      ...typePatch,
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordOrderEvent(
    ctx,
    input.id,
    "fulfillment_changed",
    { at: newDay, type: nextType, total: typePatch.total },
    actor,
  );
}
