import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import { MODULE_KEYS } from "@/core/modules/registry";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";

/**
 * Серверные функции админки продавца. Каждая начинается с requireAdmin():
 * контекст арендатора берётся из сессии, подключение к базе — под его ролью.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");
const adminOwner = async () => (await import("@/app/auth/guards.server")).requireAdminRole("owner");
const actor = async () => (await import("@/app/auth/guards.server")).adminActor();
const uuid = z.string().uuid();

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveAdminLogin, checkAdminPassword } = await import("./admin.server");
    const { appSession } = await import("@/app/auth/session.server");
    const { clientIp, loginLocked, recordLogin, loginDelay } =
      await import("@/app/auth/login-guard.server");
    const ip = clientIp();
    await loginDelay();
    // Один вход на всех: данные оператора платформы открывают панель оператора.
    {
      const { isOperatorUsername, verifyOperator, operatorStamp } =
        await import("@/app/operator/credentials.server");
      if (await isOperatorUsername(data.username)) {
        if (await loginLocked("operator", ip))
          throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
        const ok = await verifyOperator(data.username, data.password);
        await recordLogin("operator", ip, ok, data.username);
        if (!ok) return { ok: false as const };
        await (
          await appSession()
        ).update({
          operator: true,
          operatorStamp: (await operatorStamp()) ?? undefined,
        });
        return { ok: true as const, role: "operator" as const };
      }
    }
    const login = await resolveAdminLogin(data.username);
    if (!login) return { ok: false as const };
    const t = login.tenant;
    // Сессии продавца ещё нет — текст сразу на языке магазина.
    const { adminT } = await import("@/app/i18n/admin");
    const tr = adminT(t.settings.default_locale ?? "ru");
    // Клиента ещё обслуживает прежняя платформа: заказы и выдача идут там,
    // и подтверждение заказа отсюда осталось бы без бота (токен только у v1).
    {
      const { servedByV2 } = await import("@/core/tenant/directory");
      if (!servedByV2(t)) throw shownError(tr("err.login.oldPlatform"));
    }
    if (await loginLocked({ botId: t.id }, ip)) throw shownError(tr("err.login.tooMany"));
    const ok = checkAdminPassword(login, data.password);
    await recordLogin({ botId: t.id }, ip, ok, data.username);
    if (!ok) return { ok: false as const };
    const { adminStamp } = await import("@/app/auth/guards.server");
    const username = data.username.trim().toLowerCase();
    await (
      await appSession()
    ).update({
      admin: {
        botId: t.id,
        username,
        role: login.role,
        stamp: adminStamp(t.id, username, login.passwordHash),
      },
    });
    return { ok: true as const, role: "admin" as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  await (await appSession()).update({ admin: undefined });
  return { ok: true };
});

export const adminShopFn = createServerFn({ method: "GET" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  if (!s.data.admin?.botId) return null;
  try {
    const ctx = await admin();
    const { VERTICALS } = await import("@/core/verticals/registry");
    const { getSettings } = await import("@/core/settings/settings");
    const { isLocale } = await import("@/core/i18n/locale");
    const st = await getSettings(ctx, ["shop_name", "admin_locale", "shop_currency"]);
    const shopName = st.shop_name ?? ctx.tenant.name;
    const locale = isLocale(st.admin_locale)
      ? st.admin_locale
      : (ctx.tenant.settings.default_locale ?? "ru");
    return {
      botId: ctx.tenant.id,
      name: shopName,
      /** Язык админки продавца — app_settings.admin_locale, иначе язык магазина. */
      locale,
      /** Валюта магазина по умолчанию — для новых товаров и реквизитов. */
      currency: (st.shop_currency ?? "KZT").toUpperCase(),
      role: await (await import("@/app/auth/guards.server")).adminRole(),
      username: s.data.admin.username,
      vertical: ctx.tenant.vertical,
      verticalTitle: VERTICALS[ctx.tenant.vertical].title,
      modules: ctx.tenant.modules,
      status: ctx.tenant.status,
      telegram: ctx.tenant.settings.telegram?.username ?? null,
      slug: ctx.tenant.settings.slug ?? null,
      chatUnread: ctx.tenant.modules.manager_chat
        ? await (await import("@/core/chat/chat")).totalUnread(ctx).catch(() => 0)
        : 0,
      /** Сколько исходящих не доставлено после всех повторов — бейдж в навигации. */
      undelivered: await (
        await import("@/core/outbox/outbox")
      )
        .countUndelivered(ctx)
        .catch(() => 0),
    };
  } catch {
    return null;
  }
});

export const setAdminLocaleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ locale: z.enum(["ru", "kk", "en", "uz"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/settings/settings")).setSetting(ctx, "admin_locale", data.locale);
    return { ok: true };
  });

export const dashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { orderCounts, revenue, listOrdersForAdmin } = await import("@/core/orders/admin");
  const [counts, rev30, recent] = await Promise.all([
    orderCounts(ctx),
    revenue(ctx, 30),
    listOrdersForAdmin(ctx, { limit: 8 }),
  ]);
  const { listPaymentMethods } = await import("@/core/settings/payment-methods");
  const { getSettings } = await import("@/core/settings/settings");
  const [{ count: products }, { count: customers }, methods, settings, { count: anyOrders }] =
    await Promise.all([
      ctx.db.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
      ctx.db.from("bot_users").select("user_key", { count: "exact", head: true }),
      listPaymentMethods(ctx),
      getSettings(ctx, ["legal_requisites", "admin_chat_id", "setup_hidden"]),
      ctx.db.from("orders").select("id", { count: "exact", head: true }),
    ]);
  return {
    counts,
    rev30,
    recent,
    products: products ?? 0,
    customers: customers ?? 0,
    // Чек-лист первых шагов на «Обзоре» для только что открытого магазина.
    setup: {
      telegram: Boolean(ctx.tenant.telegramTokenEnc),
      products: (products ?? 0) > 0,
      payment: methods.length > 0 || ctx.tenant.modules.robokassa,
      legal: Boolean(settings.legal_requisites),
      notifications: Boolean(settings.admin_chat_id || ctx.tenant.ownerTelegramId),
      // Первый заказ — хотя бы тестовый на себя: значит, путь до оплаты пройден.
      firstOrder: (anyOrders ?? 0) > 0,
      hidden: settings.setup_hidden === "1",
      slug: ctx.tenant.settings.slug ?? null,
      // Пустой магазин может начать с примеров своей ниши (core/templates).
      template:
        (products ?? 0) === 0 &&
        (await (await import("@/core/templates/apply.server")).templateAvailable(ctx)),
    },
  };
});

/** Категории и скрытые примеры товаров ниши — только в пустой магазин. */
export const applyNicheTemplateFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  const { applyNicheTemplate } = await import("@/core/templates/apply.server");
  return applyNicheTemplate(ctx);
});

/** Продавец убрал чек-лист первых шагов с обзора. */
export const hideSetupFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  await (await import("@/core/settings/settings")).setSetting(ctx, "setup_hidden", "1");
  return { ok: true };
});

/* ── команда ─────────────────────────────────────────────────────── */

export const teamFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await adminOwner();
  return (await import("./admin.server")).listTeam(ctx);
});

export const saveTeamMemberFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        username: z.string().min(3).max(40),
        name: z.string().max(80).optional(),
        role: z.enum(["manager", "viewer"]),
        password: z.string().min(8).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("admin_roles", "owner");
    await (await import("./admin.server")).saveTeamMember(ctx, data);
    return { ok: true };
  });

export const deleteTeamMemberFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    await (await import("./admin.server")).deleteTeamMember(ctx, data.username);
    return { ok: true };
  });

/* ── каталог ─────────────────────────────────────────────────────── */

/** Импорт каталога из CSV: предпросмотр (что создастся и обновится) или применение. */
export const importCatalogFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ csv: z.string().min(1).max(4_000_000), apply: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const m = await import("@/core/catalog/import.server");
    if (!data.apply) return { preview: await m.previewImport(ctx, data.csv), result: null };
    return { preview: null, result: await m.applyImport(ctx, data.csv) };
  });

export const categoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await import("@/core/catalog/admin")).listAllCategories(ctx);
});

export const saveCategoryFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid.nullable(),
        name: z.string().min(1).max(120),
        parentId: uuid.nullable(),
        sortOrder: z.number().int().default(0),
        isVisible: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const m = await import("@/core/catalog/admin");
    const { id, ...input } = data;
    if (id) {
      await m.updateCategory(ctx, id, input);
      return { id };
    }
    return { id: await m.createCategory(ctx, input) };
  });

export const deleteCategoryFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/catalog/admin")).deleteCategory(ctx, data.id);
    return { ok: true };
  });

export const productsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().optional(),
        categoryId: uuid.nullable().optional(),
        onlyInactive: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const m = await import("@/core/catalog/admin");
    const [products, categories] = await Promise.all([
      m.listProductsForAdmin(ctx, data),
      m.listAllCategories(ctx),
    ]);
    return { products, categories };
  });

export const productFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid.nullable() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const m = await import("@/core/catalog/admin");
    const { listPaymentMethods } = await import("@/core/settings/payment-methods");
    const [product, categories, methods] = await Promise.all([
      data.id ? m.getProductForAdmin(ctx, data.id) : null,
      m.listAllCategories(ctx),
      listPaymentMethods(ctx),
    ]);
    const waiting =
      data.id && ctx.tenant.modules.waitlist
        ? await (await import("@/core/waitlist/waitlist")).countWaiting(ctx, data.id)
        : 0;
    return {
      product,
      waiting,
      categories,
      countries: methods
        .filter((x) => x.is_active)
        .map((x) => ({ code: x.country_code, name: x.country_name, currency: x.currency })),
      defaultFulfillment: (await import("@/core/verticals/registry")).VERTICALS[ctx.tenant.vertical]
        .defaultFulfillment,
    };
  });

const productInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  keywords: z.string().max(1000).default(""),
  price: z.number().min(0),
  currency: z.string().length(3),
  countryPrices: z.record(z.string(), z.number().positive()).default({}),
  categoryIds: z.array(uuid).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  fulfillmentKind: z.enum(["digital", "physical"]),
  stockQuantity: z.number().int().min(0).nullable().default(null),
  leadTimeDays: z.number().int().min(0).nullable().default(null),
  images: z.array(z.string().min(1)).max(20).default([]),
  materials: z
    .array(
      z.object({
        language: z.enum(["ru", "kk", "en", "uz"]),
        filePath: z.string().min(1),
        fileName: z.string().nullable(),
      }),
    )
    .max(50)
    .default([]),
  variants: z
    .array(z.object({ name: z.string().min(1).max(80), price: z.number().min(0) }))
    .max(30)
    .default([]),
});

export const saveProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid.nullable(), product: productInput }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const m = await import("@/core/catalog/admin");
    const { images, materials, variants, ...fields } = data.product;
    if (fields.fulfillmentKind === "digital" && materials.length === 0)
      throw new UserError(
        "err.admin.digitalNeedsFile",
        "Цифровому товару нужен хотя бы один файл — иначе покупатель заплатит и ничего не получит.",
      );
    let id = data.id;
    const before = id ? await stockState(ctx, id) : null;
    if (id) await m.updateProduct(ctx, id, fields);
    else id = await m.createProduct(ctx, fields);
    await Promise.all([
      m.setProductImages(ctx, id, images),
      m.setProductMaterials(ctx, id, materials),
      m.setProductVariants(ctx, id, variants),
    ]);
    const waitlist = await maybeNotifyWaitlist(ctx, id, before);
    return { id, waitlist };
  });

async function stockState(ctx: TenantContext, id: string) {
  const { data } = await ctx.db
    .from("products")
    .select("is_active, stock_quantity, name")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Товар вернулся в продажу — лист ожидания получает сообщение (модуль waitlist). */
async function maybeNotifyWaitlist(
  ctx: TenantContext,
  id: string,
  before: Awaited<ReturnType<typeof stockState>> | null,
) {
  if (!ctx.tenant.modules.waitlist || !before) return null;
  const after = await stockState(ctx, id);
  const { backInStock } = await import("@/core/waitlist/waitlist");
  if (!after || !backInStock(before, after)) return null;
  const { notifyBackInStock } = await import("@/app/waitlist/notify.server");
  return notifyBackInStock(ctx, { id, name: after.name });
}

export const deleteProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/catalog/admin")).deleteProduct(ctx, data.id);
    return { ok: true };
  });

export const setProductActiveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid, active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const before = await stockState(ctx, data.id);
    await (await import("@/core/catalog/admin")).setProductActive(ctx, data.id, data.active);
    const waitlist = await maybeNotifyWaitlist(ctx, data.id, before);
    return { ok: true, waitlist };
  });

/* ── заказы ──────────────────────────────────────────────────────── */

export const ordersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        status: z.string().optional(),
        q: z.string().optional(),
        pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const m = await import("@/core/orders/admin");
    const [orders, counts] = await Promise.all([
      m.listOrdersForAdmin(ctx, data),
      m.orderCounts(ctx),
    ]);
    return { orders, counts };
  });

export const orderFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { getOrder } = await import("@/core/orders/orders");
    const { proofSignedUrl } = await import("@/core/orders/admin");
    const { listOrderEvents } = await import("@/core/orders/events");
    const order = await getOrder(ctx, data.id);
    if (!order) throw new UserError("err.admin.orderNotFound", "Заказ не найден");
    const { activeDeliveryZones, amountDueNow } = await import("@/core/fulfillment/fulfillment");
    type DeliveryZone = Awaited<ReturnType<typeof activeDeliveryZones>>[number];
    const physical = order.fulfillment_kind === "physical";
    const [proofUrl, events, zones, dueNow] = await Promise.all([
      order.payment_proof_path ? proofSignedUrl(ctx, order.payment_proof_path) : null,
      listOrderEvents(ctx, data.id),
      physical ? activeDeliveryZones(ctx) : Promise.resolve<DeliveryZone[]>([]),
      physical ? amountDueNow(ctx, order) : Number(order.total),
    ]);
    return { order, proofUrl, events, zones, dueNow };
  });

export const undeliveredFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { listUndelivered } = await import("@/core/outbox/outbox");
  const rows = await listUndelivered(ctx);
  const ids = Array.from(new Set(rows.map((r) => r.orderId).filter((x): x is number => !!x)));
  const { data } = ids.length
    ? await ctx.db.from("orders").select("id, order_no, display_no").in("id", ids)
    : { data: [] as Array<{ id: number; order_no: number; display_no: number | null }> };
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
  const { minFulfillmentDate } = await import("@/core/orders/physical-admin");
  const { data, error } = await ctx.db
    .from("products")
    .select(
      "id, name, price, currency, lead_time_days, stock_quantity, product_variants(id, name, price, sort_order)",
    )
    .eq("is_active", true)
    .eq("fulfillment_kind", "physical")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  const zones = await Promise.all(
    (await activeDeliveryZones(ctx)).map(async (z) => {
      const fee = await zoneFee(ctx, z.price, null);
      return { id: z.id, name: z.name, price: fee.amount, currency: fee.currency };
    }),
  );
  return {
    products: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      currency: p.currency,
      leadDays: Number(p.lead_time_days) || 0,
      stock: ctx.tenant.modules.stock ? p.stock_quantity : null,
      variants: [...(p.product_variants ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => ({ id: v.id, name: v.name, price: Number(v.price) })),
    })),
    zones,
    today: minFulfillmentDate(ctx, 0),
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
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { updateOrderFulfillment } = await import("@/core/orders/physical-admin");
    await updateOrderFulfillment(ctx, data, await actor());
    return { ok: true };
  });

/* ── покупатели ──────────────────────────────────────────────────── */

export const customersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await admin();
    return (await import("@/core/orders/admin")).listCustomers(ctx, data.q);
  });

export const setBlockedFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: z.number().int(),
        blocked: z.boolean(),
        username: z.string().nullable().optional(),
        firstName: z.string().nullable().optional(),
        reason: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("blocked", "manager");
    await (
      await import("@/core/orders/admin")
    ).setBlocked(ctx, data.telegramId, data.blocked, data);
    return { ok: true };
  });

/* ── настройки ───────────────────────────────────────────────────── */

export const SETTING_KEYS = [
  "shop_name",
  "shop_currency",
  "shop_tagline",
  "storefront_accent",
  "stars_rate",
  "admin_chat_id",
  "admin_contact_link",
  "instruction_caption",
  "cart_reminder_hours",
  "delivery_lang_timing",
  "loyalty_earn_percent",
  "referral_discount_percent",
  "smart_search_enabled",
  "smart_search_daily_count",
  "smart_search_daily_spend",
  "smart_search_lifetime_spend",
  "smart_search_last_error",
  "receipt_ocr_auto",
  "receipt_ocr_usage",
  "consultant_enabled",
  "consultant_profile",
  "consultant_knowledge",
  "consultant_usage",
  "consultant_last_error",
  "fulfillment_pickup_enabled",
  "fulfillment_delivery_enabled",
  "payment_mode",
  "deposit_percent",
  "legal_offer",
  "legal_privacy",
  "legal_requisites",
  "legal_about",
  "vip_group_id",
  "vip_payment_instructions",
  "vip_test_mode",
  "vip_warn_days",
  "vip_warn_days_2",
  "vip_welcome_message",
  "robokassa_enabled",
  "robokassa_test_mode",
  "robokassa_login",
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
] as const;

export const settingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { getSettings } = await import("@/core/settings/settings");
  const { listPaymentMethods } = await import("@/core/settings/payment-methods");
  const [settings, methods] = await Promise.all([
    getSettings(ctx, SETTING_KEYS),
    listPaymentMethods(ctx),
  ]);
  const { platformHasKey } = await import("@/core/search/smart.server");
  const { visionConfigured } = await import("@/core/receipts/verify.server");
  return {
    settings,
    methods,
    ownerTelegramId: ctx.tenant.ownerTelegramId,
    timezone: ctx.tenant.settings.timezone ?? null,
    pdfWatermark: ctx.tenant.settings.delivery?.pdf_watermark === true,
    smartSearchKey: platformHasKey(),
    visionKey: visionConfigured(),
  };
});

/** Часовой пояс магазина — в bots.settings: его читает контекст арендатора без похода в app_settings. */
export const setShopTimezoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ timezone: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { validTimezone } = await import("@/core/tenant/directory");
    const tz = validTimezone(data.timezone.trim() || undefined);
    if (data.timezone.trim() && !tz)
      throw new UserError("err.admin.unknownTimezone", "Неизвестный часовой пояс");
    const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
    await patchTenantSettings(ctx.tenant.id, { timezone: tz ?? "" });
    return { ok: true, timezone: tz ?? null };
  });

/** Водяной знак на выдаваемых PDF — в bots.settings.delivery (читает core/delivery). */
export const setPdfWatermarkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
    await patchTenantSettings(ctx.tenant.id, { delivery: { pdf_watermark: data.enabled } });
    return { ok: true, enabled: data.enabled };
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.record(z.enum(SETTING_KEYS), z.string().max(4000)).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { setSetting } = await import("@/core/settings/settings");
    for (const [k, v] of Object.entries(data)) await setSetting(ctx, k, v);
    return { ok: true };
  });

export const savePaymentMethodFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid.nullable(),
        countryCode: z.string().min(2).max(8),
        countryName: z.string().min(1).max(80),
        currency: z.string().length(3),
        instructions: z.string().max(4000),
        qrCodePath: z.string().nullable(),
        isActive: z.boolean(),
        sortOrder: z.number().int(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { id, ...input } = data;
    return {
      id: await (await import("@/core/settings/payment-methods")).savePaymentMethod(ctx, id, input),
    };
  });

export const deletePaymentMethodFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    await (await import("@/core/settings/payment-methods")).deletePaymentMethod(ctx, data.id);
    return { ok: true };
  });

export const requestModuleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.enum(MODULE_KEYS as [string, ...string[]]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { error } = await ctx.db
      .from("module_requests")
      .insert({ bot_id: ctx.tenant.id, module_key: data.key });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    return { ok: true, already: Boolean(error) };
  });

/* ── тариф магазина (core/plans) ─────────────────────────────────── */

export const myPlanFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { parsePlan, nicheForVertical, MONTHLY_PRICE, CONNECTION_PRICE, ADDON_KEYS } =
    await import("@/core/plans/registry");
  const { planUsage, USAGE_KEYS } = await import("@/core/plans/tenant");
  const { getSettings } = await import("@/core/settings/settings");
  const plan = parsePlan(ctx.tenant.plan);
  const values = await getSettings(ctx, Object.values(USAGE_KEYS));
  const { data: pending } = await ctx.db
    .from("module_requests")
    .select("module_key")
    .eq("status", "pending");
  const billing = ctx.tenant.settings.billing ?? {};
  return {
    plan: plan?.kind === "tier" ? plan.tier : plan?.kind === "custom" ? ("custom" as const) : null,
    hasTiers: Boolean(nicheForVertical(ctx.tenant.vertical)),
    period: billing.period ?? "month",
    trialUntil: billing.trial_until ?? null,
    addons: billing.addons ?? [],
    availableAddons: ADDON_KEYS,
    prices: { monthly: MONTHLY_PRICE, connection: CONNECTION_PRICE },
    usage: planUsage(ctx.tenant, values),
    pending: (pending ?? []).map((r) => r.module_key),
  };
});

export const requestPlanFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.enum([
          "plan:basic",
          "plan:pro",
          "plan:business",
          "addon:whatsapp",
          "addon:instagram",
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { error } = await ctx.db
      .from("module_requests")
      .insert({ bot_id: ctx.tenant.id, module_key: data.key });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    return { ok: true };
  });

/** «Оплатить»: счёт на сумму плана со ссылкой и QR Kaspi Pay (или реквизитами). */
export const payPlanFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminOwner();
  const { ownerPayInvoice } = await import("@/app/operator/plans.server");
  const { qrSvg } = await import("@/core/billing/pay/kaspi-link");
  const r = await ownerPayInvoice(ctx.tenant.id, await actor());
  return { ...r, qr: r.payUrl ? qrSvg(r.payUrl) : null };
});

/* ── Telegram из админки ─────────────────────────────────────────── */

export const telegramStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { webhookState } = await import("@/app/operator/operator.server");
  return {
    connected: Boolean(ctx.tenant.telegramTokenEnc),
    username: ctx.tenant.settings.telegram?.username ?? null,
    servedBy: ctx.tenant.settings.served_by ?? null,
    webhook: await webhookState(ctx.tenant.id),
  };
});

/** Instagram и WhatsApp: подключённые аккаунты Zernio из снимка в настройках клиента. */
export const zernioStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { zernioConfigured } = await import("@/channels/zernio/api.server");
  const z = ctx.tenant.settings.zernio;
  return {
    configured: zernioConfigured(),
    accounts: z?.accounts ?? [],
    manualIds: (z?.account_ids ?? []).filter((id) => !(z?.accounts ?? []).some((a) => a.id === id)),
    syncedAt: z?.synced_at ?? null,
  };
});

export const zernioConnectLinkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ platform: z.enum(["instagram", "whatsapp"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    if (!ctx.tenant.modules[data.platform])
      throw new UserError(
        "err.admin.channelOff",
        "Этот канал не подключён к вашему тарифу — оставьте заявку в «Модулях».",
      );
    const { connectLink } = await import("@/channels/zernio/connect.server");
    return { url: await connectLink(ctx.tenant, data.platform) };
  });

export const syncZernioAccountsFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminOwner();
  const { syncAccounts } = await import("@/channels/zernio/connect.server");
  return syncAccounts(ctx.tenant);
});

/** Продавец подключает бота сам: токен → getMe → шифрование → вебхук на эту платформу. */
export const connectTelegramAdminFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ token: z.string().regex(/^\d+:[\w-]{30,}$/, "Не похоже на токен BotFather") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { connectTelegram, setServedBy } = await import("@/app/operator/operator.server");
    const r = await connectTelegram(ctx.tenant.id, data.token, "admin");
    const webhook = await setServedBy(ctx.tenant.id, "v2", "admin");
    return { username: r.username, webhook };
  });

/* ── промокоды и сертификаты ─────────────────────────────────────── */

export const promoCodesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { data, error } = await ctx.db
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const savePromoCodeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid.nullable(),
        code: z.string().min(2).max(40),
        discountType: z.enum(["percent", "fixed"]),
        discountValue: z.number().positive(),
        maxUses: z.number().int().positive().nullable(),
        validUntil: z.string().nullable(),
        isActive: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("coupons", "manager");
    const { normalizeCode } = await import("@/core/discounts/pure");
    if (data.discountType === "percent" && data.discountValue > 100)
      throw new UserError("err.admin.percentMax", "Процент не больше 100.");
    const row = {
      code: normalizeCode(data.code),
      discount_type: data.discountType,
      discount_value: data.discountValue,
      max_uses: data.maxUses,
      valid_until: data.validUntil ? new Date(data.validUntil).toISOString() : null,
      is_active: data.isActive,
    };
    const q = data.id
      ? ctx.db.from("promo_codes").update(row).eq("id", data.id)
      : ctx.db.from("promo_codes").insert({ bot_id: ctx.tenant.id, ...row });
    const { error } = await q;
    if (error)
      throw /duplicate|unique/i.test(error.message)
        ? new UserError("err.admin.codeTaken", "Такой код уже есть.")
        : new Error(error.message);
    return { ok: true };
  });

export const deletePromoCodeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { error } = await ctx.db.from("promo_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const giftCertificatesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { data, error } = await ctx.db
    .from("gift_certificates")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createGiftCertificateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        amount: z.number().positive(),
        currency: z.string().length(3),
        note: z.string().max(200).optional(),
        code: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("gift_certificates", "manager");
    const { generateGiftCode, normalizeCode } = await import("@/core/discounts/pure");
    for (let i = 0; i < 5; i++) {
      const code = data.code?.trim() ? normalizeCode(data.code) : generateGiftCode();
      const { data: row, error } = await ctx.db
        .from("gift_certificates")
        .insert({
          bot_id: ctx.tenant.id,
          code,
          amount: data.amount,
          currency: data.currency.toUpperCase(),
          note: data.note ?? null,
          status: "active",
        })
        .select("code")
        .single();
      if (!error && row) return { code: row.code };
      if (data.code?.trim() && /duplicate|unique/i.test(error?.message ?? ""))
        throw new UserError("err.admin.codeTaken", "Такой код уже есть.");
      if (data.code?.trim() || !/duplicate|unique/i.test(error?.message ?? ""))
        throw new Error(error?.message ?? "insert failed");
    }
    throw new UserError("err.admin.codeGenFailed", "Не удалось подобрать уникальный код");
  });

export const cancelGiftCertificateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { error } = await ctx.db
      .from("gift_certificates")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ── зоны доставки ───────────────────────────────────────────────── */

export const deliveryZonesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { data, error } = await ctx.db
    .from("delivery_zones")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const saveDeliveryZoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid.nullable(),
        name: z.string().min(1).max(80),
        price: z.number().min(0),
        isActive: z.boolean(),
        sortOrder: z.number().int(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const row = {
      name: data.name.trim(),
      price: data.price,
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };
    const { error } = data.id
      ? await ctx.db.from("delivery_zones").update(row).eq("id", data.id)
      : await ctx.db.from("delivery_zones").insert({ bot_id: ctx.tenant.id, ...row });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDeliveryZoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { error } = await ctx.db.from("delivery_zones").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ── рассылки ────────────────────────────────────────────────────── */

const audienceSchema = z.enum(["all", "buyers", "non_buyers", "country", "test"]);
const channelSchema = z.enum(["telegram", "whatsapp"]).default("telegram");

/** Аккаунты WhatsApp клиента из снимка Zernio — от чьего имени идёт рассылка шаблонами. */
function whatsAppAccountsOf(ctx: TenantContext) {
  return (ctx.tenant.settings.zernio?.accounts ?? [])
    .filter((a) => a.platform === "whatsapp" && !a.expired)
    .map((a) => ({ id: a.id, name: a.name ?? a.username ?? a.id }));
}

export const broadcastsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdminAnyModule } = await import("@/app/auth/guards.server");
  const ctx = await requireAdminAnyModule("broadcasts", "wa_broadcasts");
  const { listBroadcasts, audienceCountries } = await import("@/core/broadcasts/broadcasts");
  const { getSettings } = await import("@/core/settings/settings");
  const { listTemplates, templateBody, templateParamCount } =
    await import("@/core/whatsapp/templates");
  const wa = ctx.tenant.modules.wa_broadcasts;
  const [broadcasts, countries, products, settings, templates] = await Promise.all([
    listBroadcasts(ctx),
    audienceCountries(ctx),
    ctx.db
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .limit(200)
      .then((r) => r.data ?? []),
    getSettings(ctx, ["cart_reminder_hours", "admin_chat_id", "whatsapp_bot_excluded_phones"]),
    wa ? listTemplates(ctx) : Promise.resolve([]),
  ]);
  return {
    broadcasts,
    countries,
    products,
    cartReminderHours: settings.cart_reminder_hours ?? "",
    hasAdminChat: Boolean(settings.admin_chat_id || ctx.tenant.ownerTelegramId),
    telegram: ctx.tenant.modules.broadcasts && Boolean(ctx.tenant.telegramTokenEnc),
    telegramModule: ctx.tenant.modules.broadcasts,
    whatsapp: wa
      ? {
          accounts: whatsAppAccountsOf(ctx),
          excludedPhones: settings.whatsapp_bot_excluded_phones ?? "",
          templates: templates.map((t) => ({
            id: t.id,
            accountId: t.account_id,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            reason: t.reason,
            body: templateBody(t.components),
            paramCount: templateParamCount(t.components),
            updatedAt: t.updated_at,
          })),
        }
      : null,
  };
});

export const audienceCountFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        audience: audienceSchema,
        countryCode: z.string().max(3).optional(),
        channel: channelSchema,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const filter = { country_code: data.countryCode };
    if (data.channel === "whatsapp") {
      const ctx = await requireAdminModule("wa_broadcasts");
      const { resolveWhatsAppAudience } = await import("@/core/broadcasts/broadcasts");
      return { count: (await resolveWhatsAppAudience(ctx, data.audience, filter)).length };
    }
    const ctx = await requireAdminModule("broadcasts");
    const { resolveAudience } = await import("@/core/broadcasts/broadcasts");
    return { count: (await resolveAudience(ctx, data.audience, filter)).length };
  });

export const createBroadcastFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        channel: channelSchema,
        text: z.string().max(4000).default(""),
        photoKeys: z.array(z.string().min(1).max(300)).max(10).default([]),
        productIds: z.array(uuid).max(8).default([]),
        showCatalog: z.boolean().default(false),
        audience: audienceSchema,
        countryCode: z.string().max(3).optional(),
        whatsapp: z
          .object({
            accountId: z.string().min(1).max(100),
            templateName: z.string().min(1).max(512),
            templateLanguage: z.string().min(2).max(16),
            templateParams: z.array(z.string().max(1024)).max(20).default([]),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule(
      data.channel === "whatsapp" ? "wa_broadcasts" : "broadcasts",
      "manager",
    );
    const { createBroadcast } = await import("@/core/broadcasts/broadcasts");
    if (data.channel === "whatsapp") {
      if (!data.whatsapp)
        throw new UserError("err.admin.waPickTemplate", "Выберите аккаунт и шаблон WhatsApp.");
      const { ownsWhatsAppAccount } = await import("@/channels/zernio/templates.server");
      if (!ownsWhatsAppAccount(ctx, data.whatsapp.accountId))
        throw new UserError(
          "err.admin.waNotYours",
          "Этот аккаунт WhatsApp не подключён к вашему магазину.",
        );
      const { data: tpl } = await ctx.db
        .from("whatsapp_templates")
        .select("status, components")
        .eq("account_id", data.whatsapp.accountId)
        .eq("name", data.whatsapp.templateName)
        .eq("language", data.whatsapp.templateLanguage)
        .maybeSingle();
      if (!tpl)
        throw new UserError(
          "err.admin.waTemplateMissing",
          "Шаблон не найден — обновите список шаблонов.",
        );
      if (tpl.status !== "APPROVED")
        throw new UserError(
          "err.admin.waTemplateNotApproved",
          "Шаблон ещё не одобрен Meta (статус {status}) — отправлять нельзя.",
          { status: tpl.status },
        );
      const { templateParamCount } = await import("@/core/whatsapp/templates");
      const need = templateParamCount(tpl.components);
      const params = data.whatsapp.templateParams.map((p) => p.trim());
      if (params.length < need || params.slice(0, need).some((p) => !p))
        throw new UserError(
          "err.admin.waTemplateParams",
          "Шаблон ждёт {count} подстановок — заполните все.",
          { count: need },
        );
      data.whatsapp.templateParams = params.slice(0, need);
    }
    const r = await createBroadcast(ctx, {
      channel: data.channel,
      text: data.text,
      photoKeys: data.photoKeys,
      productIds: data.productIds,
      showCatalog: data.showCatalog,
      audience: data.audience,
      filter: data.countryCode ? { country_code: data.countryCode } : undefined,
      whatsapp: data.whatsapp,
    });
    if (!r.ok) throw new Error(r.message);
    // Первый пакет — сразу: продавец видит результат на «себе», не ожидая крона.
    if (data.audience === "test" && data.channel === "telegram") {
      const { runBroadcastBatch } = await import("@/channels/telegram/jobs");
      await runBroadcastBatch(ctx.tenant).catch((e) => console.error("[broadcast:test]", e));
    }
    return { id: r.broadcast.id, total: r.broadcast.total_count };
  });

export const syncWhatsAppTemplatesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("wa_broadcasts", "manager");
    const { syncWhatsAppTemplates } = await import("@/channels/zernio/templates.server");
    const r = await syncWhatsAppTemplates(ctx, data.accountId);
    if (!r.ok)
      throw r.error
        ? new Error(r.error)
        : new UserError("err.admin.waSyncFailed", "Не удалось обновить шаблоны");
    return { count: r.count };
  });

export const createWhatsAppTemplateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1).max(100),
        name: z.string().min(1).max(512),
        language: z.string().min(2).max(16),
        category: z.enum(["UTILITY", "MARKETING"]),
        body: z.string().min(1).max(1024),
        buttons: z
          .array(
            z.discriminatedUnion("type", [
              z.object({ type: z.literal("QUICK_REPLY"), text: z.string().min(1).max(25) }),
              z.object({
                type: z.literal("URL"),
                text: z.string().min(1).max(25),
                url: z.string().url().max(2000),
              }),
              z.object({
                type: z.literal("PHONE_NUMBER"),
                text: z.string().min(1).max(25),
                phone: z.string().min(5).max(20),
              }),
            ]),
          )
          .max(3)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("wa_broadcasts", "manager");
    const { submitWhatsAppTemplate } = await import("@/channels/zernio/templates.server");
    const r = await submitWhatsAppTemplate(ctx, data);
    if (!r.ok)
      throw r.error
        ? new Error(r.error)
        : new UserError("err.admin.waRejected", "Meta не приняла шаблон");
    return { name: r.name };
  });

export const setExcludedPhonesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ phones: z.string().max(20000) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("wa_broadcasts", "manager");
    const { parseExcludedPhones } = await import("@/core/broadcasts/broadcasts");
    const { setSetting } = await import("@/core/settings/settings");
    const phones = [...parseExcludedPhones(data.phones)].join(", ");
    await setSetting(ctx, "whatsapp_bot_excluded_phones", phones);
    return { phones };
  });

export const cancelBroadcastFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("broadcasts", "manager");
    const { cancelBroadcast } = await import("@/core/broadcasts/broadcasts");
    return { ok: await cancelBroadcast(ctx, data.id) };
  });

/* ── аналитика ───────────────────────────────────────────────────── */

export const analyticsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    return (await import("@/core/analytics/analytics")).analytics(ctx, data.days);
  });

/* ── чат с менеджером ────────────────────────────────────────────── */

/** Читать чат может любая роль; подключаться и писать покупателю — менеджер и владелец. */
const chatModule = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("manager_chat", min);
// Покупатели из Instagram/WhatsApp живут под синтетическим отрицательным
// telegram_id (core/customers), поэтому «положительный» здесь не годится.
const tgId = z
  .number()
  .int()
  .refine((n) => n !== 0, "telegram_id не может быть нулём");

/** Кому можно поручить диалог: владелец и менеджеры (наблюдатель отвечать не может). */
function inboxAssignees(
  ctx: TenantContext,
): { username: string; name: string | null; owner: boolean }[] {
  const a = ctx.tenant.settings.admin;
  const owner = a?.username ? [{ username: a.username, name: null, owner: true }] : [];
  const managers = (a?.users ?? [])
    .filter((u) => u.role === "manager")
    .map((u) => ({ username: u.username, name: u.name ?? null, owner: false }));
  return [...owner, ...managers];
}

/** Единый входящий: диалоги всех каналов с учётом «решено» и ответственного. */
export const chatConversationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await chatModule();
  const { listConversations, totalUnread } = await import("@/core/chat/chat");
  const inbox = await import("@/core/inbox/inbox");
  const { getSetting } = await import("@/core/settings/settings");
  const { adminIdentity } = await import("@/app/auth/guards.server");
  const [list, unread, rawReplies, me] = await Promise.all([
    listConversations(ctx),
    totalUnread(ctx),
    getSetting(ctx, inbox.QUICK_REPLIES_KEY),
    adminIdentity(),
  ]);
  const ids = list.map((c) => c.telegram_id);
  const [meta, tickets] = await Promise.all([
    inbox.inboxMetaFor(ctx, ids),
    ctx.tenant.modules.helpdesk ? inbox.openTicketNumbers(ctx, ids) : new Map<number, number[]>(),
  ]);
  return {
    conversations: inbox.mergeInbox(list, meta, tickets),
    unread,
    me: me?.username ?? "",
    assignees: inboxAssignees(ctx),
    quickReplies: inbox.parseQuickReplies(rawReplies),
  };
});

export const inboxSetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        status: z.enum(["open", "closed"]).optional(),
        assignee: z.string().max(40).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { adminActor } = await import("@/app/auth/guards.server");
    if (data.assignee && !inboxAssignees(ctx).some((a) => a.username === data.assignee))
      throw new UserError("err.admin.inboxAssignee", "Такого пользователя нет в команде магазина.");
    const { setInboxMeta } = await import("@/core/inbox/inbox");
    const meta = await setInboxMeta(
      ctx,
      data.telegramId,
      { status: data.status, assignee: data.assignee },
      await adminActor(),
    );
    return { status: meta.status, assignee: meta.assignee };
  });

export const quickRepliesSaveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        replies: z
          .array(z.object({ title: z.string().max(200), text: z.string().max(4000) }))
          .max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { cleanQuickReplies, QUICK_REPLIES_KEY } = await import("@/core/inbox/inbox");
    const { setSetting } = await import("@/core/settings/settings");
    const replies = cleanQuickReplies(data.replies);
    await setSetting(ctx, QUICK_REPLIES_KEY, JSON.stringify(replies));
    return { replies, count: replies.length };
  });

export const chatMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listMessages, markRead } = await import("@/core/chat/chat");
    const messages = await listMessages(ctx, data.telegramId);
    await markRead(ctx, data.telegramId);
    return messages;
  });

export const chatConnectFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ telegramId: tgId, active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const chat = await import("@/core/chat/chat");
    if (data.active) await chat.connect(ctx, data.telegramId);
    else {
      await chat.disconnect(ctx, data.telegramId);
      // Вернули боту — консультант снова отвечает этому покупателю.
      const { getCustomerByTelegramId } = await import("@/core/customers/customers");
      const c = await getCustomerByTelegramId(ctx, data.telegramId);
      if (c) await (await import("@/core/consultant/engine.server")).resumeConsultant(ctx, c);
    }
    return { ok: true };
  });

export const chatReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ telegramId: tgId, text: z.string().trim().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { replyAsManager } = await import("./admin.server");
    await replyAsManager(ctx, data.telegramId, data.text);
    // Ничей диалог достаётся тому, кто ответил первым.
    const { adminIdentity, adminActor } = await import("@/app/auth/guards.server");
    const inbox = await import("@/core/inbox/inbox");
    const me = await adminIdentity();
    const meta = await inbox.getInboxMeta(ctx, data.telegramId);
    if (me && !meta.assignee)
      await inbox.setInboxMeta(ctx, data.telegramId, { assignee: me.username }, await adminActor());
    return { ok: true };
  });

/* ── ИИ-консультант ──────────────────────────────────────────────── */

export const consultantFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { loadConsultant, consultantConfigured, KEYS } =
    await import("@/core/consultant/engine.server");
  const { getSettings } = await import("@/core/settings/settings");
  const [c, s] = await Promise.all([
    loadConsultant(ctx),
    getSettings(ctx, [KEYS.usage, KEYS.lastError]),
  ]);
  let usage = { count: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  try {
    usage = { ...usage, ...(JSON.parse(s[KEYS.usage] || "{}") as object) };
  } catch {
    /* пусто */
  }
  return { ...c, configured: consultantConfigured(), usage, lastError: s[KEYS.lastError] ?? "" };
});

export const saveConsultantFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        profile: z.object({
          brand_name: z.string().min(1).max(120),
          goal: z.enum(["direct_sales", "book_call", "booking", "expert_faq"]),
          tone: z.enum(["friendly_expert", "formal", "luxury_warm", "casual"]),
          primary_language: z.enum(["ru", "kk", "en"]),
          countries: z.array(z.string().max(8)).max(10),
          currency: z.string().min(3).max(3),
          website_url: z.string().max(200).optional(),
          delivery_info: z.string().max(1000).optional(),
          payment_info: z.string().max(1000).optional(),
          about: z.string().max(1500).optional(),
          custom_instructions: z.string().max(3000).optional(),
          medical_disclaimer: z.boolean().optional(),
        }),
        docs: z
          .array(
            z.object({
              id: z.string().max(40),
              title: z.string().min(1).max(160),
              category: z.string().max(80).optional(),
              content: z.string().min(1).max(6000),
            }),
          )
          .max(60),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { setSetting } = await import("@/core/settings/settings");
    const { KEYS } = await import("@/core/consultant/engine.server");
    await setSetting(ctx, KEYS.enabled, data.enabled ? "true" : "false");
    await setSetting(ctx, KEYS.profile, JSON.stringify(data.profile));
    await setSetting(ctx, KEYS.knowledge, JSON.stringify(data.docs));
    return { ok: true };
  });

/** Проверка из админки: ответ на пробный вопрос без записи истории. */
export const consultantTestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ text: z.string().trim().min(1).max(1000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { runConsultant } = await import("@/core/consultant/engine.server");
    const r = await runConsultant(ctx, null, data.text, { platform: "admin_test", dryRun: true });
    if (!r)
      throw new UserError("err.admin.noAnthropicKey", "На платформе не задан ключ Anthropic.");
    return r;
  });
