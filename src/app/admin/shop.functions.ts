import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import { SETUP_STEPS, toggleSkippedStep } from "./setup";
import { subscriptionView, trialBanner } from "./admin-shared";

/**
 * Админка продавца: магазин продавца, переключение магазинов, главная и первые шаги.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

/** Разделы бухгалтера (guards.server requireAdminFinance): ответ без контактов, если это он. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();

const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

async function subscriptionAlert(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  trial: unknown,
) {
  if (trial) return null;
  const sub = await subscriptionView(ctx);
  return sub && sub.state !== "ok" ? sub : null;
}

/**
 * Продаёт ли клиент (`sellsNow`) — для «Обзора» и меню. Сбой чтения — как
 * раньше (магазин): лучше лишняя карточка про продажи, чем пустая админка.
 */
async function sellsOrAsBefore(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  where: string,
): Promise<boolean> {
  try {
    return await (await import("@/core/tenant/sells.server")).sellsNow(ctx);
  } catch (e) {
    console.error(
      `[admin:${ctx.tenant.id}] продаёт ли, ${where}`,
      e instanceof Error ? e.message : e,
    );
    return true;
  }
}

export const adminShopFn = createServerFn({ method: "GET" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  if (!s.data.admin?.botId) return null;
  try {
    const { ctx, accountant } = await finance();
    const trial = accountant ? null : await trialBanner(ctx);
    const { VERTICALS } = await import("@/core/verticals/registry");
    const { getSettings } = await import("@/core/settings/settings");
    const { isLocale } = await import("@/core/i18n/locale");
    const st = await getSettings(ctx, ["shop_name", "admin_locale", "shop_currency"]);
    const shopName = st.shop_name ?? ctx.tenant.name;
    const locale = isLocale(st.admin_locale)
      ? st.admin_locale
      : (ctx.tenant.settings.default_locale ?? "ru");
    // Чтения, что при сбое дают 0 в бейджах меню: блок «Ждёт вас» показывает их как сбой, а не «0».
    const waitingFailed: string[] = [];
    const role = await (await import("@/app/auth/guards.server")).adminRole();
    const pricelist = (await import("@/core/consultant/pricelist/mode")).pricelistMode(ctx.tenant);
    const sells = await sellsOrAsBefore(ctx, "меню");
    const { consultantWorkspace } = await import("./nav-model");
    const { roleAllows } = await import("@/core/auth/roles");
    return {
      botId: ctx.tenant.id,
      name: shopName,
      /** Язык админки продавца — app_settings.admin_locale, иначе язык магазина. */
      locale,
      /** Валюта магазина по умолчанию — для новых товаров и реквизитов. */
      currency: (st.shop_currency ?? "KZT").toUpperCase(),
      role,
      username: s.data.admin.username,
      vertical: ctx.tenant.vertical,
      verticalTitle: VERTICALS[ctx.tenant.vertical].title,
      modules: ctx.tenant.modules,
      /** Работы учеников на проверке (модуль «Курсы») — бейдж «Домашние задания». */
      homeworkWaiting:
        ctx.tenant.modules.courses && !accountant
          ? await import("@/core/courses/homework.server")
              .then(async (m) => m.waitingCount(await m.listHomework(ctx)))
              .catch(() => {
                waitingFailed.push("homework");
                return 0;
              })
          : 0,
      /** Консультант по прайсу (BOVI) — пункт «Прайс консультанта» в меню. */
      pricelist,
      /** Продаёт ли клиент (`sellsNow`): консультант без продаж — нижняя панель без заказов и товаров. */
      sells,
      /**
       * Открытые задачи консультанта — бейдж «Задачи» рабочего места (консультант
       * без продаж, менеджер и выше). Сбой чтения — null: бейджа нет, а не «0». Шапка — на
       * каждой странице: весь список задач читается, только когда он изменился.
       */
      consultantTasksOpen:
        !accountant && roleAllows(role, "manager") && consultantWorkspace({ sells, pricelist })
          ? await (await import("@/core/consultant/tasks-badge")).openTasksCount(ctx).catch((e) => {
              console.error(
                `[admin:${ctx.tenant.id}] бейдж задач`,
                e instanceof Error ? e.message : e,
              );
              return null;
            })
          : null,
      consultantMediaDemands:
        !accountant && roleAllows(role, "manager") && consultantWorkspace({ sells, pricelist })
          ? await (await import("@/core/consultant/pricelist/media-catalog.server"))
              .openMediaDemandsCount(ctx)
              .catch((e) => {
                console.error(
                  `[admin:${ctx.tenant.id}] бейдж спроса на медиа`,
                  e instanceof Error ? e.message : e,
                );
                return null;
              })
          : null,
      status: ctx.tenant.status,
      /** Пробный период на виду: до какого дня, сколько осталось и что будет после (плашка в шапке). */
      trial,
      /** Подписка кончается или просрочена (вне пробного периода) — плашка «Оплатить». */
      subscription: accountant ? null : await subscriptionAlert(ctx, trial),
      /** Владелец попросил удалить магазин: когда удалится (ISO) — баннер «Восстановить». */
      deletionAt: ctx.tenant.settings.deletion
        ? (await import("@/core/tenant/deletion"))
            .deletionDueAt(ctx.tenant.settings.deletion.requested_at)
            .toISOString()
        : null,
      telegram: ctx.tenant.settings.telegram?.username ?? null,
      slug: ctx.tenant.settings.slug ?? null,
      chatUnread:
        ctx.tenant.modules.manager_chat && !accountant
          ? await (await import("@/core/chat/chat")).totalUnread(ctx).catch((e) => {
              // Не «0 непрочитанных», а «не известно»: бейдж не рисуется, сбой — в журнале.
              console.error(
                `[admin:${ctx.tenant.id}] бейдж чата`,
                e instanceof Error ? e.message : e,
              );
              return null;
            })
          : 0,
      /** Открытые обращения helpdesk — бейдж «Обращения» в навигации. */
      ticketsOpen:
        ctx.tenant.modules.helpdesk && !accountant
          ? await (await import("@/core/helpdesk/tickets")).countOpenTickets(ctx).catch(() => {
              waitingFailed.push("tickets");
              return 0;
            })
          : 0,
      /** Непрочитанные новости платформы — бейдж «Что нового» (сбой — без бейджа, не 0 «прочитано»). */
      newsUnread: accountant
        ? 0
        : await (await import("@/core/news/news")).newsUnread(ctx).catch((e) => {
            console.error(
              `[admin:${ctx.tenant.id}] бейдж новостей`,
              e instanceof Error ? e.message : e,
            );
            return 0;
          }),
      /** Непрочитанные ответы поддержки — бейдж «Поддержка» (сбой — без бейджа, в журнал). */
      supportUnread: accountant
        ? 0
        : await (await import("@/core/support/support")).supportUnread(ctx).catch((e) => {
            console.error(
              `[admin:${ctx.tenant.id}] бейдж поддержки`,
              e instanceof Error ? e.message : e,
            );
            return 0;
          }),
      /** Сколько исходящих не доставлено после всех повторов — бейдж в навигации. */
      undelivered: accountant
        ? 0
        : await (await import("@/core/outbox/outbox")).countUndelivered(ctx).catch(() => {
            waitingFailed.push("undelivered");
            return 0;
          }),
      /** Какие числа «Ждёт вас» не прочитались (в бейджах меню они 0): плитка скажет «не удалось загрузить». */
      waitingFailed,
    };
  } catch {
    return null;
  }
});

/** Удалить магазин: пауза и 30 дней на восстановление (app/admin/deletion.server). Только владелец. */
export const deleteShopFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ confirm: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminRole } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminRole("owner");
    const { requestShopDeletion } = await import("./deletion.server");
    return requestShopDeletion(ctx, data.confirm, await actor());
  });

export const restoreShopFn = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdminRole } = await import("@/app/auth/guards.server");
  const ctx = await requireAdminRole("owner");
  const { cancelShopDeletion } = await import("./deletion.server");
  await cancelShopDeletion(ctx, await actor());
  return { ok: true };
});

/** Модуль «Несколько ботов»: магазины группы для переключателя в шапке. */
export const adminShopsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { adminShops } = await import("@/app/auth/guards.server");
  const { current, shops } = await adminShops();
  return { current, shops: shops.map((t) => ({ id: t.id, name: t.name })) };
});

export const switchShopFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await (await import("@/app/auth/guards.server")).switchAdminShop(data.botId);
    return { ok: true };
  });

export const setAdminLocaleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ locale: z.enum(["ru", "kk", "en", "uz"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/settings/settings")).setSetting(ctx, "admin_locale", data.locale);
    return { ok: true };
  });

export const dashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const { ctx, accountant } = await finance();
  const { orderCounts, revenue, listOrdersForAdmin } = await import("@/core/orders/admin");
  // Консультант без продаж (BOVI): без карточек про товары, оплату, заказы и выручку —
  // и без их чтений: выручка, последние заказы, темп и рост на его «Обзоре» не показываются.
  const sells = await sellsOrAsBefore(ctx, "обзор");
  const noRevenue = { total: 0, currency: "KZT", orders: 0 };
  const [counts, rev30, recent] = await Promise.all([
    orderCounts(ctx),
    sells ? revenue(ctx, 30) : noRevenue,
    sells ? listOrdersForAdmin(ctx, { limit: 5 }) : [],
  ]);
  const { listPaymentMethods } = await import("@/core/settings/payment-methods");
  const { getSettings } = await import("@/core/settings/settings");
  const [
    { count: products },
    { count: customers },
    methods,
    settings,
    { count: anyOrders },
    { data: firstProduct },
  ] = await Promise.all([
    ctx.db.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    ctx.db.from("bot_users").select("user_key", { count: "exact", head: true }),
    listPaymentMethods(ctx),
    getSettings(ctx, [
      "legal_requisites",
      "admin_chat_id",
      "setup_hidden",
      "setup_skipped",
      "shop_tagline",
      "fulfillment_pickup_enabled",
      "fulfillment_delivery_enabled",
      "moved_welcome_hidden",
      "starter_ids",
    ]),
    ctx.db.from("orders").select("id", { count: "exact", head: true }),
    // Первый включённый товар — на нём продавец делает тестовый заказ себе.
    ctx.db
      .from("products")
      .select("id")
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  const {
    showMovedWelcome,
    testOrderLink,
    PRODUCTS_TARGET,
    relevantSetupSteps,
    parseSkippedSteps,
  } = await import("./setup");
  // Переехавшему с v1 продавцу — карточка «что где теперь» (один раз).
  const since = ctx.tenant.settings.served_by_since;
  const movedCandidate =
    ctx.tenant.settings.served_by === "v2" && since && settings.moved_welcome_hidden !== "1";
  let ordersBeforeMove = 0;
  if (movedCandidate) {
    const before = await ctx.db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .lt("created_at", since);
    if (before.error) throw serverFailure(`Админка: ${before.error.message}`);
    ordersBeforeMove = before.count ?? 0;
  }
  const { redactOrders } = await import("@/core/orders/redact");
  const { starterLeft } = await import("@/core/templates/apply.server");
  const starter = settings.starter_ids ? await starterLeft(ctx, settings.starter_ids) : 0;
  // Лимиты тарифа — только продавцу: бухгалтеру их не показываем.
  let limits: import("@/core/plans/tenant").LimitNotice[] = [];
  if (!accountant) {
    const { planUsage, limitNotices, USAGE_KEYS } = await import("@/core/plans/tenant");
    const usageValues = await getSettings(ctx, Object.values(USAGE_KEYS));
    limits = limitNotices(ctx.tenant.plan, planUsage(ctx.tenant, usageValues));
  }
  // «Что сделать сегодня»: задачи и выручка за сутки/неделю — только продавцу, не бухгалтеру.
  let today: import("@/core/overview/today").TodayTask[] = [];
  let rev1 = rev30;
  let rev7 = rev30;
  // Продажи к этому же времени вчера и по часам (Ж3): сбой чтения — «не удалось загрузить», страница живёт.
  let pace: import("@/core/overview/pace").SalesPace | "failed" | null = null;
  // Блок «Рост» (У5): три числа за 30 суток против прежних; видят все роли, сбой чтения — «не удалось загрузить».
  // Без продаж блок «Рост» не рисуется — и не читается.
  const growth: import("@/core/overview/growth").Growth | "failed" = !sells
    ? "failed"
    : await import("@/core/overview/growth.server")
        .then((m) => m.loadGrowth(ctx))
        .catch((e): "failed" => {
          console.error(`[admin:${ctx.tenant.id}] рост`, e instanceof Error ? e.message : e);
          return "failed";
        });
  // «Первые 7 дней» (Р3): не прочиталось — карточку просто не показываем.
  const firstWeek = accountant
    ? null
    : await import("./onboarding.server")
        .then((m) => m.loadFirstWeek(ctx))
        .catch((e): "failed" => {
          console.error(
            `[admin:${ctx.tenant.id}] первые 7 дней`,
            e instanceof Error ? e.message : e,
          );
          return "failed";
        });
  if (!accountant) {
    [today, rev1, rev7, pace] = await Promise.all([
      (await import("@/core/overview/today")).todayTasks(ctx),
      sells ? revenue(ctx, 1) : noRevenue,
      sells ? revenue(ctx, 7) : noRevenue,
      !sells
        ? null
        : import("@/core/overview/pace.server")
            .then((m) => m.loadSalesPace(ctx))
            .catch((e): "failed" => {
              console.error(
                `[admin:${ctx.tenant.id}] продажи за сегодня`,
                e instanceof Error ? e.message : e,
              );
              return "failed";
            }),
    ]);
  }
  return {
    counts,
    rev30,
    rev1,
    rev7,
    pace,
    growth,
    today,
    limits,
    recent: accountant ? redactOrders(recent) : recent,
    products: products ?? 0,
    customers: customers ?? 0,
    sells,
    firstWeek,
    // Чек-лист первых шагов на «Обзоре» для только что открытого магазина.
    setup: {
      telegram: Boolean(ctx.tenant.telegramTokenEnc),
      // Магазин считается наполненным с пяти товаров; «хоть один» — в `productsAny`.
      products: (products ?? 0) >= PRODUCTS_TARGET,
      // Способ получения «сделан», когда продавец сохранил выбор: по умолчанию включены оба.
      delivery:
        settings.fulfillment_pickup_enabled !== undefined ||
        settings.fulfillment_delivery_enabled !== undefined,
      // Строка-приветствие магазина, которую видит покупатель в боте и на витрине.
      botTexts: Boolean(settings.shop_tagline?.trim()),
      productsCount: products ?? 0,
      relevant: relevantSetupSteps({
        modules: ctx.tenant.modules,
        vertical: ctx.tenant.vertical,
        sells,
      }),
      skipped: parseSkippedSteps(settings.setup_skipped),
      payment: methods.length > 0 || ctx.tenant.modules.robokassa,
      legal: Boolean(settings.legal_requisites),
      notifications: Boolean(settings.admin_chat_id || ctx.tenant.ownerTelegramId),
      // Первый заказ — хотя бы тестовый на себя: значит, путь до оплаты пройден.
      firstOrder: (anyOrders ?? 0) > 0,
      testOrder: testOrderLink(
        ctx.tenant.telegramTokenEnc ? (ctx.tenant.settings.telegram?.username ?? null) : null,
        firstProduct?.id ?? null,
      ),
      hidden: settings.setup_hidden === "1",
      moved: showMovedWelcome({
        servedBy: ctx.tenant.settings.served_by,
        since,
        hidden: settings.moved_welcome_hidden === "1",
        ordersBeforeMove,
      }),
      slug: ctx.tenant.settings.slug ?? null,
      // Скрытые примеры набора, которые ещё лежат в магазине: плашка «Убрать примеры».
      starter,
      // Пустой магазин может начать с примеров своей ниши (core/templates).
      template:
        sells &&
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

/** Шаблон магазина по типу (Р2): категории, тексты «О магазине», выдача и оплата — только в пустой магазин. */
export const applyShopKindFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ kind: z.enum(["digital", "goods", "services"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { applyShopKind } = await import("@/core/templates/shop-kind.server");
    return applyShopKind(ctx, data.kind);
  });

/** «Убрать примеры»: удаляет только созданное стартовым набором (core/templates). */
export const removeStarterFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  const { removeStarter } = await import("@/core/templates/apply.server");
  return removeStarter(ctx);
});

/** Продавец убрал чек-лист первых шагов с обзора. */
export const hideSetupFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  await (await import("@/core/settings/settings")).setSetting(ctx, "setup_hidden", "1");
  return { ok: true };
});

/** Скрыть шаг запуска магазина или вернуть его в список («Запуск» на главной). */
export const skipSetupStepFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ step: z.enum(SETUP_STEPS), skip: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { getSettingsStrict, setSetting } = await import("@/core/settings/settings");
    const cur = (await getSettingsStrict(ctx, ["setup_skipped"])).setup_skipped;
    await setSetting(ctx, "setup_skipped", toggleSkippedStep(cur, data.step, data.skip));
    return { ok: true };
  });

/** Продавец, переехавший с v1, закрыл карточку «что где теперь». */
export const hideMovedWelcomeFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  await (await import("@/core/settings/settings")).setSetting(ctx, "moved_welcome_hidden", "1");
  return { ok: true };
});
