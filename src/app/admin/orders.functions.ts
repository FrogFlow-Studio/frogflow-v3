import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: заказы: список, карточка, действия, ручной заказ, оплата и доставка.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

/** Разделы бухгалтера (guards.server requireAdminFinance): ответ без контактов, если это он. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();

const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

const uuid = z.string().uuid();

/* ── заказы ──────────────────────────────────────────────────────── */

export const ordersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        status: z.string().optional(),
        q: z.string().optional(),
        pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
        unpaid: z.boolean().optional(),
        assembly: z.literal("today").optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { ctx, accountant } = await finance();
    const m = await import("@/core/orders/admin");
    // Поиск по имени и телефону — это тоже контакты: бухгалтер ищет по номеру.
    const { accountantSearch, redactOrders } = await import("@/core/orders/redact");
    const q = accountant ? accountantSearch(data.q) : data.q;
    const { loadSummary } = await import("@/core/fulfillment/capacity");
    const { todayInTz } = await import("@/core/fulfillment/pure");
    const [orders, counts, load] = await Promise.all([
      m.listOrdersForAdmin(ctx, { ...data, q }),
      m.orderCounts(ctx),
      // Загрузка дня при лимитах: числа без контактов, видны всем ролям заказов.
      loadSummary(ctx, todayInTz(ctx.timezone)),
    ]);
    return { orders: accountant ? redactOrders(orders) : orders, counts, load };
  });

/** Отпечаток заказов для живого обновления страниц (core/orders/live). */
export const ordersStampFn = createServerFn({ method: "GET" }).handler(async () => {
  const { ctx } = await finance();
  const { ordersStamp } = await import("@/core/orders/live");
  return ordersStamp(ctx);
});

export const orderFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { ctx, accountant } = await finance();
    const { getOrder } = await import("@/core/orders/orders");
    const { proofSignedUrl } = await import("@/core/orders/admin");
    const { listOrderEvents } = await import("@/core/orders/events");
    const order = await getOrder(ctx, data.id);
    if (!order) throw new UserError("err.admin.orderNotFound", "Заказ не найден");
    const { activeDeliveryZones, amountDueNow } = await import("@/core/fulfillment/fulfillment");
    type DeliveryZone = Awaited<ReturnType<typeof activeDeliveryZones>>[number];
    const physical = order.fulfillment_kind === "physical";
    const { fulfillmentSlots } = await import("@/core/fulfillment/slots");
    // Нерабочие и занятые даты — предупреждение при переносе даты: перенос ими не ограничен.
    const { closedRules } = await import("@/core/fulfillment/closed-days");
    const { busyOverview } = await import("@/core/fulfillment/capacity");
    const { minFulfillmentDate } = await import("@/core/orders/physical-admin");
    const dateRules = physical
      ? await (async () => {
          const rules = await closedRules(ctx);
          return {
            closedWeekdays: rules.weekdays,
            closedRanges: rules.ranges,
            fullDays: (await busyOverview(ctx, minFulfillmentDate(ctx, 0))).fullDays,
          };
        })()
      : {
          closedWeekdays: [] as number[],
          closedRanges: [] as Awaited<ReturnType<typeof closedRules>>["ranges"],
          fullDays: [] as string[],
        };
    const [proofUrl, events, zones, dueNow, slots] = await Promise.all([
      order.payment_proof_path ? proofSignedUrl(ctx, order.payment_proof_path) : null,
      listOrderEvents(ctx, data.id),
      physical ? activeDeliveryZones(ctx) : Promise.resolve<DeliveryZone[]>([]),
      physical ? amountDueNow(ctx, order) : Number(order.total),
      physical ? fulfillmentSlots(ctx) : Promise.resolve<string[]>([]),
    ]);
    // Чек на остаток по задатку лежит событием заказа (core/orders/balance).
    const { balanceProofPending, lastBalanceProofPath } = await import("@/core/orders/balance");
    const balancePath = lastBalanceProofPath(events);
    const [balanceProofUrl, balancePending] = await Promise.all([
      balancePath ? proofSignedUrl(ctx, balancePath) : null,
      balancePath ? balanceProofPending(ctx, order.id, order.paid_amount) : false,
    ]);
    // Ссылка на страницу заказа — отправить покупателю, когда канал не донёс выдачу.
    const { orderPageUrl } = await import("@/core/storefront/web-order");
    const pageUrl = await orderPageUrl(ctx, order.id);
    // Возвраты — события таймлайна (core/orders/refund): сколько вернули и сколько ещё можно.
    const { receivedAmount, REFUNDABLE_STATUSES } = await import("@/core/orders/refund");
    const refunded =
      Math.round(
        events
          .filter((e) => e.kind === "refund")
          .reduce((s, e) => s + (Number(e.payload.amount) || 0), 0) * 100,
      ) / 100;
    // Фото на согласование — состояние по событиям таймлайна (core/orders/approval).
    const { approvalState } = await import("@/core/orders/approval");
    const approval = approvalState(events);
    const { imageUrl } = await import("@/core/catalog/catalog");
    const approvalPhotoUrl = approval.status === "none" ? null : imageUrl(ctx, approval.key);
    // Курьер — последнее событие courier таймлайна (core/fulfillment/courier).
    const { courierState } = await import("@/core/fulfillment/courier");
    const courier = courierState(events);
    // «Это подарок»: получатель и открытка — из события заказа; бухгалтеру без текста.
    const { giftFromPayload } = await import("@/core/orders/gift");
    const giftEvent = events.find((e) => e.kind === "gift");
    const gift = giftEvent ? giftFromPayload(giftEvent.payload) : null;
    // Первое фото каждого товара заказа — миниатюра в составе. Только украшение: сбой чтения не роняет карточку.
    const itemPhotos: Record<string, string> = {};
    {
      const pids = [
        ...new Set(
          (order.order_items ?? []).map((i) => i.product_id).filter((x): x is string => !!x),
        ),
      ];
      for (let i = 0; i < pids.length; i += 200) {
        const { data: imgs, error: imgError } = await ctx.db
          .from("product_images")
          .select("product_id, image_path, sort_order, id")
          .in("product_id", pids.slice(i, i + 200))
          .order("sort_order")
          .order("id");
        if (imgError) {
          console.error(`[admin:${ctx.tenant.id}] фото товаров заказа`, imgError.message);
          break;
        }
        for (const r of imgs ?? [])
          if (!itemPhotos[r.product_id]) itemPhotos[r.product_id] = imageUrl(ctx, r.image_path);
      }
    }
    const refundable = (REFUNDABLE_STATUSES as readonly string[]).includes(order.status)
      ? Math.max(0, Math.round((receivedAmount(order) - refunded) * 100) / 100)
      : 0;
    const { resolveOrderOrigin } = await import("@/core/orders/origin");
    const rules =
      order.platform === "instagram"
        ? await (async () => {
            try {
              const { listAutomations } = await import("@/channels/zernio/automations.server");
              return await listAutomations(ctx);
            } catch {
              return [];
            }
          })()
        : [];
    const origin = await resolveOrderOrigin(ctx, order, events, { rules });
    if (!accountant)
      return {
        order,
        origin,
        proofUrl,
        balanceProofUrl,
        balancePending,
        events,
        zones,
        dueNow,
        pageUrl,
        refunded,
        refundable,
        slots,
        ...dateRules,
        approval,
        approvalPhotoUrl,
        courier,
        gift,
        itemPhotos,
      };
    // Бухгалтеру: без контактов; журнал — только события и время, без текста.
    const { redactOrder, redactEventPayload } = await import("@/core/orders/redact");
    return {
      order: redactOrder(order),
      origin,
      proofUrl,
      balanceProofUrl,
      balancePending,
      events: events.map((e) => ({ ...e, actor: "", payload: redactEventPayload(e.payload) })),
      zones,
      dueNow,
      pageUrl: null,
      refunded,
      refundable,
      slots,
      ...dateRules,
      approval,
      approvalPhotoUrl,
      courier: courier ? { ...courier, phone: null } : null,
      gift: gift ? { recipient: "", message: "", truncated: false } : null,
      itemPhotos,
    };
  });

export const undeliveredFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { listUndelivered } = await import("@/core/outbox/outbox");
  const rows = await listUndelivered(ctx);
  const ids = Array.from(new Set(rows.map((r) => r.orderId).filter((x): x is number => !!x)));
  const { data, error: namesError } = ids.length
    ? await ctx.db.from("orders").select("id, order_no, display_no").in("id", ids)
    : {
        data: [] as Array<{ id: number; order_no: number; display_no: number | null }>,
        error: null,
      };
  if (namesError) throw serverFailure(`Админка: ${namesError.message}`);
  const no = new Map((data ?? []).map((o) => [o.id, o.display_no ?? o.order_no]));
  return rows.map((r) => ({ ...r, orderNo: r.orderId ? (no.get(r.orderId) ?? null) : null }));
});

export const outboxActionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid, action: z.enum(["retry", "dismiss"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { retryOutbox, dismissOutbox } = await import("@/core/outbox/outbox");
    const ok =
      data.action === "retry" ? await retryOutbox(ctx, data.id) : await dismissOutbox(ctx, data.id);
    return { ok };
  });

export const orderActionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        action: z.enum(["confirm", "reject", "next", "prev", "remind"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await import("./admin.server")).runOrderAction(
      ctx,
      data.id,
      data.action,
      await actor(),
    );
  });

export const orderTrackingFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), text: z.string().trim().min(1).max(300) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await import("./admin.server")).runOrderTracking(
      ctx,
      data.id,
      data.text,
      await actor(),
    );
  });

export const orderNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), note: z.string().max(2000).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/orders/admin")).setOrderNote(ctx, data.id, data.note);
    return { ok: true };
  });

/* ── ручной заказ, оплата, получение (физические товары) ─────────── */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

/** Что нужно форме ручного заказа: физические товары с вариантами и зоны. */
export const manualOrderFormFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { activeDeliveryZones, zoneFee } = await import("@/core/fulfillment/fulfillment");
  const { manualOrderProducts, minFulfillmentDate } = await import("@/core/orders/physical-admin");
  const zones = await Promise.all(
    (await activeDeliveryZones(ctx)).map(async (z) => {
      const fee = await zoneFee(ctx, z.price, null);
      return { id: z.id, name: z.name, price: fee.amount, currency: fee.currency };
    }),
  );
  // Нерабочие и занятые даты — предупреждение продавцу: ручной заказ ими не ограничен.
  const today = minFulfillmentDate(ctx, 0);
  const { closedRules } = await import("@/core/fulfillment/closed-days");
  const { busyOverview } = await import("@/core/fulfillment/capacity");
  const rules = await closedRules(ctx);
  return {
    products: await manualOrderProducts(ctx),
    zones,
    today,
    closedWeekdays: rules.weekdays,
    closedRanges: rules.ranges,
    fullDays: (await busyOverview(ctx, today)).fullDays,
  };
});

export const createManualOrderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        displayName: z.string().trim().min(1).max(120),
        contact: z.string().trim().max(40).nullable(),
        items: z
          .array(
            z.object({
              productId: uuid,
              variantId: uuid.nullable(),
              quantity: z.number().int().min(1).max(99),
            }),
          )
          .min(1)
          .max(20),
        fulfillmentType: z.enum(["pickup", "delivery"]),
        fulfillmentAt: isoDate,
        address: z.string().trim().max(500).nullable(),
        note: z.string().trim().max(500).nullable(),
        deliveryZoneId: uuid.nullable(),
        paidAmount: z.number().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { createManualOrder } = await import("@/core/orders/physical-admin");
    return createManualOrder(ctx, data, await actor());
  });

export const recordPaymentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), amount: z.number().positive() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { recordManualPayment } = await import("@/core/orders/physical-admin");
    return recordManualPayment(ctx, data.id, data.amount, await actor());
  });

/** Передать заказ курьеру со ссылкой на отслеживание (модуль courier). */
export const dispatchCourierFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        provider: z.enum(["yandex", "indrive", "own", "other"]),
        trackUrl: z.string().max(500).nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("courier", "manager");
    const { dispatchCourier } = await import("./admin.server");
    return dispatchCourier(ctx, data.id, data, await actor());
  });

/** Фото готового заказа покупателю на согласование (core/orders/approval). */
export const sendApprovalFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        key: z.string().min(1).max(300),
        note: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { sendApprovalPhoto } = await import("./admin.server");
    return sendApprovalPhoto(ctx, data.id, data, await actor());
  });

/** Возврат денег по заказу: полный или частичный (core/orders/refund), покупателю — сообщение. */
export const refundOrderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        amount: z.number().positive(),
        reason: z.string().max(500).nullable().optional(),
        restock: z.boolean().optional(),
        notify: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { refundAndNotify } = await import("./admin.server");
    return refundAndNotify(ctx, data.id, data, await actor());
  });

/** «Отклонить чек на остаток»: покупатель снова может доплатить (core/orders/balance). */
export const rejectBalanceProofFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { rejectBalanceProofAndNotify } = await import("./balance.server");
    return rejectBalanceProofAndNotify(ctx, data.id, await actor());
  });

export const updateFulfillmentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        fulfillmentAt: isoDate,
        address: z.string().trim().max(500).nullable(),
        note: z.string().trim().max(500).nullable(),
        fulfillmentType: z.enum(["pickup", "delivery"]).nullable().optional(),
        deliveryZoneId: uuid.nullable().optional(),
        slot: z.string().max(20).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { updateOrderFulfillment } = await import("@/core/orders/physical-admin");
    await updateOrderFulfillment(ctx, data, await actor());
    return { ok: true };
  });
