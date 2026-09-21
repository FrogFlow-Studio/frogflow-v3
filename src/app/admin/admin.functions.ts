import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MODULE_KEYS } from "@/core/modules/registry";

/**
 * Серверные функции админки продавца. Каждая начинается с requireAdmin():
 * контекст арендатора берётся из сессии, подключение к базе — под его ролью.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const uuid = z.string().uuid();

export const adminLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { findTenantByAdminUsername, checkAdminPassword } = await import("./admin.server");
    const { appSession } = await import("@/app/auth/session.server");
    const { clientIp, loginLocked, recordLogin, loginDelay } =
      await import("@/app/auth/login-guard.server");
    const ip = clientIp();
    await loginDelay();
    const t = await findTenantByAdminUsername(data.username);
    if (!t) return { ok: false as const };
    if (await loginLocked({ botId: t.id }, ip))
      throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
    const ok = checkAdminPassword(t, data.password);
    await recordLogin({ botId: t.id }, ip, ok, data.username);
    if (!ok) return { ok: false as const };
    await (
      await appSession()
    ).update({ admin: { botId: t.id, username: data.username.trim().toLowerCase() } });
    return { ok: true as const };
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
    const { getSetting } = await import("@/core/settings/settings");
    const shopName = (await getSetting(ctx, "shop_name")) ?? ctx.tenant.name;
    return {
      botId: ctx.tenant.id,
      name: shopName,
      vertical: ctx.tenant.vertical,
      verticalTitle: VERTICALS[ctx.tenant.vertical].title,
      modules: ctx.tenant.modules,
      status: ctx.tenant.status,
      telegram: ctx.tenant.settings.telegram?.username ?? null,
      slug: ctx.tenant.settings.slug ?? null,
    };
  } catch {
    return null;
  }
});

export const dashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { orderCounts, revenue, listOrdersForAdmin } = await import("@/core/orders/admin");
  const [counts, rev30, recent] = await Promise.all([
    orderCounts(ctx),
    revenue(ctx, 30),
    listOrdersForAdmin(ctx, { limit: 8 }),
  ]);
  const [{ count: products }, { count: customers }] = await Promise.all([
    ctx.db.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    ctx.db.from("bot_users").select("user_key", { count: "exact", head: true }),
  ]);
  return { counts, rev30, recent, products: products ?? 0, customers: customers ?? 0 };
});

/* ── каталог ─────────────────────────────────────────────────────── */

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
    const ctx = await admin();
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
    const ctx = await admin();
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
    return {
      product,
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
    const ctx = await admin();
    const m = await import("@/core/catalog/admin");
    const { images, materials, variants, ...fields } = data.product;
    if (fields.fulfillmentKind === "digital" && materials.length === 0)
      throw new Error(
        "Цифровому товару нужен хотя бы один файл — иначе покупатель заплатит и ничего не получит.",
      );
    let id = data.id;
    if (id) await m.updateProduct(ctx, id, fields);
    else id = await m.createProduct(ctx, fields);
    await Promise.all([
      m.setProductImages(ctx, id, images),
      m.setProductMaterials(ctx, id, materials),
      m.setProductVariants(ctx, id, variants),
    ]);
    return { id };
  });

export const deleteProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    await (await import("@/core/catalog/admin")).deleteProduct(ctx, data.id);
    return { ok: true };
  });

export const setProductActiveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid, active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    await (await import("@/core/catalog/admin")).setProductActive(ctx, data.id, data.active);
    return { ok: true };
  });

/* ── заказы ──────────────────────────────────────────────────────── */

export const ordersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ status: z.string().optional(), q: z.string().optional() }).parse(d ?? {}),
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
    const order = await getOrder(ctx, data.id);
    if (!order) throw new Error("Заказ не найден");
    const proofUrl = order.payment_proof_path
      ? await proofSignedUrl(ctx, order.payment_proof_path)
      : null;
    return { order, proofUrl };
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
    const ctx = await admin();
    return (await import("./admin.server")).runOrderAction(ctx, data.id, data.action);
  });

export const orderNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), note: z.string().max(2000).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    await (await import("@/core/orders/admin")).setOrderNote(ctx, data.id, data.note);
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
    const ctx = await requireAdminModule("blocked");
    await (
      await import("@/core/orders/admin")
    ).setBlocked(ctx, data.telegramId, data.blocked, data);
    return { ok: true };
  });

/* ── настройки ───────────────────────────────────────────────────── */

export const SETTING_KEYS = [
  "shop_name",
  "admin_chat_id",
  "admin_contact_link",
  "instruction_caption",
  "cart_reminder_hours",
  "delivery_lang_timing",
  "loyalty_earn_percent",
  "fulfillment_pickup_enabled",
  "fulfillment_delivery_enabled",
  "payment_mode",
  "deposit_percent",
  "legal_offer",
  "legal_privacy",
  "legal_requisites",
  "legal_about",
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
  return { settings, methods, ownerTelegramId: ctx.tenant.ownerTelegramId };
});

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.record(z.enum(SETTING_KEYS), z.string().max(4000)).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
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
    const ctx = await admin();
    const { id, ...input } = data;
    return {
      id: await (await import("@/core/settings/payment-methods")).savePaymentMethod(ctx, id, input),
    };
  });

export const deletePaymentMethodFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    await (await import("@/core/settings/payment-methods")).deletePaymentMethod(ctx, data.id);
    return { ok: true };
  });

export const requestModuleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.enum(MODULE_KEYS as [string, ...string[]]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { error } = await ctx.db
      .from("module_requests")
      .insert({ bot_id: ctx.tenant.id, module_key: data.key });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    return { ok: true, already: Boolean(error) };
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

/** Продавец подключает бота сам: токен → getMe → шифрование → вебхук на эту платформу. */
export const connectTelegramAdminFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ token: z.string().regex(/^\d+:[\w-]{30,}$/, "Не похоже на токен BotFather") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
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
    const ctx = await requireAdminModule("coupons");
    const { normalizeCode } = await import("@/core/discounts/pure");
    if (data.discountType === "percent" && data.discountValue > 100)
      throw new Error("Процент не больше 100.");
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
      throw new Error(
        /duplicate|unique/i.test(error.message) ? "Такой код уже есть." : error.message,
      );
    return { ok: true };
  });

export const deletePromoCodeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
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
    const ctx = await requireAdminModule("gift_certificates");
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
      if (data.code?.trim() || !/duplicate|unique/i.test(error?.message ?? ""))
        throw new Error(error?.message ?? "insert failed");
    }
    throw new Error("Не удалось подобрать уникальный код");
  });

export const cancelGiftCertificateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
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
    const ctx = await admin();
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
    const ctx = await admin();
    const { error } = await ctx.db.from("delivery_zones").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ── рассылки ────────────────────────────────────────────────────── */

const audienceSchema = z.enum(["all", "buyers", "non_buyers", "country", "test"]);

export const broadcastsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdminModule } = await import("@/app/auth/guards.server");
  const ctx = await requireAdminModule("broadcasts");
  const { listBroadcasts, audienceCountries } = await import("@/core/broadcasts/broadcasts");
  const { getSettings } = await import("@/core/settings/settings");
  const [broadcasts, countries, products, settings] = await Promise.all([
    listBroadcasts(ctx),
    audienceCountries(ctx),
    ctx.db
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .limit(200)
      .then((r) => r.data ?? []),
    getSettings(ctx, ["cart_reminder_hours", "admin_chat_id"]),
  ]);
  return {
    broadcasts,
    countries,
    products,
    cartReminderHours: settings.cart_reminder_hours ?? "",
    hasAdminChat: Boolean(settings.admin_chat_id || ctx.tenant.ownerTelegramId),
  };
});

export const audienceCountFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ audience: audienceSchema, countryCode: z.string().max(3).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("broadcasts");
    const { resolveAudience } = await import("@/core/broadcasts/broadcasts");
    const ids = await resolveAudience(ctx, data.audience, { country_code: data.countryCode });
    return { count: ids.length };
  });

export const createBroadcastFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        text: z.string().max(4000),
        photoKeys: z.array(z.string().min(1).max(300)).max(10),
        productIds: z.array(uuid).max(8),
        showCatalog: z.boolean(),
        audience: audienceSchema,
        countryCode: z.string().max(3).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("broadcasts");
    const { createBroadcast } = await import("@/core/broadcasts/broadcasts");
    const r = await createBroadcast(ctx, {
      text: data.text,
      photoKeys: data.photoKeys,
      productIds: data.productIds,
      showCatalog: data.showCatalog,
      audience: data.audience,
      filter: data.countryCode ? { country_code: data.countryCode } : undefined,
    });
    if (!r.ok) throw new Error(r.message);
    // Первый пакет — сразу: продавец видит результат на «себе», не ожидая крона.
    if (data.audience === "test") {
      const { runBroadcastBatch } = await import("@/channels/telegram/jobs");
      await runBroadcastBatch(ctx.tenant).catch((e) => console.error("[broadcast:test]", e));
    }
    return { id: r.broadcast.id, total: r.broadcast.total_count };
  });

export const cancelBroadcastFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("broadcasts");
    const { cancelBroadcast } = await import("@/core/broadcasts/broadcasts");
    return { ok: await cancelBroadcast(ctx, data.id) };
  });
