import { env } from "@/config/env";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import { serverFailure } from "@/lib/server-failure";
import { MODULE_KEYS } from "@/core/modules/registry";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { STAFF_ROLES } from "@/core/auth/roles";
import { SEARCH_MIN } from "@/core/chat/search";
import { CATALOG_LAYOUTS, CATALOG_ORDER_MAX } from "@/core/storefront/categories";
import {
  firstTooLongSetting,
  LEGAL_TEXT_MAX,
  SETTING_KEYS,
  settingsForRole,
  WRITABLE_SETTING_KEYS,
} from "./setting-keys";

/**
 * Серверные функции админки продавца. Каждая начинается с requireAdmin():
 * контекст арендатора берётся из сессии, подключение к базе — под его ролью.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");
/** Разделы бухгалтера (guards.server requireAdminFinance): ответ без контактов, если это он. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();
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
    const { issueSession, operatorSessionMark } = await import("@/app/auth/session-id");
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
        // Магазин с тем же логином входит своим паролем (auth/login-route).
        const { routeOperatorName } = await import("@/app/auth/login-route");
        const route = await routeOperatorName({
          operator: () => verifyOperator(data.username, data.password),
          shop: async () => {
            const shop = await resolveAdminLogin(data.username);
            return Boolean(shop && checkAdminPassword(shop, data.password));
          },
        });
        if (route !== "shop") {
          if (route !== "operator") {
            await recordLogin("operator", ip, false, data.username);
            return { ok: false as const };
          }
          // С двухшаговым входом сессию выдаёт только страница входа оператора,
          // где спрашивают код; здесь — лишь отправляем туда. Вход ещё не
          // состоялся, поэтому и удачным он не записывается.
          const { twoFactorStatus } = await import("@/app/operator/two-factor.server");
          if ((await twoFactorStatus()).enabled)
            return { ok: true as const, role: "operator" as const, needCode: true as const };
          await recordLogin("operator", ip, true, data.username);
          await (
            await appSession()
          ).update({
            operator: true,
            operatorStamp: (await operatorStamp()) ?? undefined,
            ...operatorSessionMark(),
          });
          return { ok: true as const, role: "operator" as const };
        }
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
        ...issueSession(),
      },
    });
    return { ok: true as const, role: "admin" as const };
  });

/**
 * Вход владельца через Telegram (app/auth/tg-login.server): бот магазина
 * присылает владельцу одноразовую ссылку. Ответ всегда один и тот же — по
 * нему не узнать, есть ли логин и привязан ли Telegram.
 */
export const adminTgLoginRequest = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const done = { ok: true as const };
    const { resolveAdminLogin } = await import("./admin.server");
    const { clientIp, loginDelay } = await import("@/app/auth/login-guard.server");
    const ip = clientIp();
    await loginDelay();
    const login = await resolveAdminLogin(data.username);
    if (!login || login.role !== "owner") return done;
    const t = login.tenant;
    const { servedByV2 } = await import("@/core/tenant/directory");
    if (!servedByV2(t) || t.archived || !t.ownerTelegramId || !t.telegramTokenEnc) return done;
    const { tenantContext } = await import("@/core/tenant/resolve.server");
    const ctx = tenantContext(t);
    const { requestTgLogin } = await import("@/app/auth/tg-login-request.server");
    const { recordShopAction } = await import("./audit.server");
    const { normalizeLogin } = await import("@/core/auth/roles");
    const { telegramApi } = await import("@/channels/telegram/api");
    const { tgLoginMessage } = await import("@/app/auth/tg-login-text");
    const r = await requestTgLogin(
      ctx,
      normalizeLogin(data.username),
      async (token) => {
        const link = `${env().APP_URL}/admin/tg-login?b=${t.id}&t=${token}`;
        await telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE)
          .call("sendMessage", {
            chat_id: t.ownerTelegramId,
            text: tgLoginMessage(t.settings.default_locale ?? "ru", link),
            link_preview_options: { is_disabled: true },
          })
          .catch(() => undefined);
      },
      (result) =>
        recordShopAction(
          { botId: t.id, username: normalizeLogin(data.username) },
          "tgLoginRequest",
          {
            result,
            ip: ip ?? "—",
          },
        ),
    );
    // Предел часа виден только настоящему владельцу магазина; остальным ответ прежний.
    if (r === "limited") return { ok: true as const, limited: true as const };
    return done;
  });

export const adminTgLoginConsume = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ b: z.string().uuid(), t: z.string().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const t = await resolveTenant({ by: "id", value: data.b });
    const { servedByV2 } = await import("@/core/tenant/directory");
    if (!t || t.archived || !servedByV2(t)) return { ok: false as const };
    const { consumeLoginToken } = await import("@/app/auth/tg-login.server");
    const username = await consumeLoginToken(tenantContext(t), data.t);
    if (!username) return { ok: false as const };
    const { resolveAdminLogin } = await import("./admin.server");
    const login = await resolveAdminLogin(username);
    if (!login || login.role !== "owner" || login.tenant.id !== t.id) return { ok: false as const };
    const { clientIp, recordLogin } = await import("@/app/auth/login-guard.server");
    await recordLogin({ botId: t.id }, clientIp(), true, `tg:${username}`);
    const { appSession } = await import("@/app/auth/session.server");
    const { issueSession } = await import("@/app/auth/session-id");
    const { adminStamp } = await import("@/app/auth/guards.server");
    await (
      await appSession()
    ).update({
      admin: {
        botId: t.id,
        username,
        role: login.role,
        stamp: adminStamp(t.id, username, login.passwordHash),
        ...issueSession(),
      },
    });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  const a = s.data.admin;
  // Сначала отзыв, потом стирание: скопированная cookie после выхода не работает.
  if (a?.sid) {
    const { revokeSession } = await import("@/app/auth/revocation.server");
    await revokeSession(a.sid, a.iat);
  }
  await s.update({ admin: undefined });
  return { ok: true };
});

/** Плашка пробного периода. Сбой чтения срока не должен выкидывать продавца из админки — без плашки. */
async function trialBanner(ctx: import("@/core/tenant/resolve.server").TenantContext) {
  try {
    const { todayInTz } = await import("@/core/fulfillment/pure");
    const today = todayInTz(ctx.timezone);
    const until = ctx.tenant.settings.billing?.trial_until;
    if (!until || until < today) return null;
    const { subscriptionExpiresAt } = await import("@/app/operator/billing.server");
    const { trialState, afterTrial } = await import("@/core/plans/trial");
    const { readPolicy } = await import("@/core/billing/subscription");
    const state = trialState(
      ctx.tenant.settings.billing,
      await subscriptionExpiresAt(ctx.tenant.id),
      today,
    );
    return state ? { ...state, after: afterTrial(readPolicy(ctx.tenant.settings)) } : null;
  } catch (e) {
    console.warn(`[admin] плашка пробного периода ${ctx.tenant.id}:`, e);
    return null;
  }
}

/** Срок подписки продавцу: до какого дня оплачено и что будет. Сбой чтения не должен выкидывать из админки — без плашки. */
async function subscriptionView(ctx: import("@/core/tenant/resolve.server").TenantContext) {
  try {
    const { subscriptionExpiresAt } = await import("@/app/operator/billing.server");
    const { readPolicy } = await import("@/core/billing/subscription");
    const { sellerSubscription } = await import("@/core/billing/seller-status");
    return sellerSubscription(
      await subscriptionExpiresAt(ctx.tenant.id),
      readPolicy(ctx.tenant.settings),
      ctx.tenant.status === "suspended",
    );
  } catch (e) {
    console.warn(`[admin] срок подписки ${ctx.tenant.id}:`, e);
    return null;
  }
}

async function subscriptionAlert(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  trial: unknown,
) {
  if (trial) return null;
  const sub = await subscriptionView(ctx);
  return sub && sub.state !== "ok" ? sub : null;
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
      /** Работы учеников на проверке (модуль «Курсы») — бейдж «Домашние задания». */
      homeworkWaiting:
        ctx.tenant.modules.courses && !accountant
          ? await import("@/core/courses/homework.server")
              .then(async (m) => m.waitingCount(await m.listHomework(ctx)))
              .catch(() => 0)
          : 0,
      /** Консультант по прайсу (BOVI) — пункт «Прайс консультанта» в меню. */
      pricelist: (await import("@/core/consultant/pricelist/mode")).pricelistMode(ctx.tenant),
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
          ? await (await import("@/core/helpdesk/tickets")).countOpenTickets(ctx).catch(() => 0)
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
      /** Сколько исходящих не доставлено после всех повторов — бейдж в навигации. */
      undelivered: accountant
        ? 0
        : await (await import("@/core/outbox/outbox")).countUndelivered(ctx).catch(() => 0),
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
  const [counts, rev30, recent] = await Promise.all([
    orderCounts(ctx),
    revenue(ctx, 30),
    listOrdersForAdmin(ctx, { limit: 8 }),
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
  const { showMovedWelcome, testOrderLink } = await import("./setup");
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
  if (!accountant) {
    [today, rev1, rev7] = await Promise.all([
      (await import("@/core/overview/today")).todayTasks(ctx),
      revenue(ctx, 1),
      revenue(ctx, 7),
    ]);
  }
  return {
    counts,
    rev30,
    rev1,
    rev7,
    today,
    limits,
    recent: accountant ? redactOrders(recent) : recent,
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

/** Продавец, переехавший с v1, закрыл карточку «что где теперь». */
export const hideMovedWelcomeFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  await (await import("@/core/settings/settings")).setSetting(ctx, "moved_welcome_hidden", "1");
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
        role: z.enum(STAFF_ROLES),
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
    return { preview: null, result: await m.applyImport(ctx, data.csv, await actor()) };
  });

/** Каталог из Google Таблицы: ссылка, настройки и итог последнего обновления. */
export const catalogSheetFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await import("@/core/catalog/sheet.server")).loadSheet(ctx);
});

/** Предпросмотр таблицы по ссылке: ничего не пишет. */
export const previewCatalogSheetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await import("@/core/catalog/sheet.server")).previewSheet(ctx, data.url);
  });

/** Подключить таблицу (или сменить настройки) и сразу загрузить её — после предпросмотра. */
export const saveCatalogSheetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        url: z.string().min(1).max(500),
        hideMissing: z.boolean(),
        overwriteManual: z.boolean(),
        run: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { sheetCsvUrl, SHEET_CONFIG_KEY } = await import("@/core/catalog/sheet");
    if (!sheetCsvUrl(data.url))
      throw new UserError(
        "err.catalog.sheetBadLink",
        "Нужна ссылка на Google Таблицу (docs.google.com/spreadsheets/…)",
      );
    const { setSetting } = await import("@/core/settings/settings");
    await setSetting(
      ctx,
      SHEET_CONFIG_KEY,
      JSON.stringify({
        url: data.url.trim(),
        hideMissing: data.hideMissing,
        overwriteManual: data.overwriteManual,
      }),
    );
    if (!data.run) return null;
    return (await (await import("@/core/catalog/sheet.server")).runSheetSync(ctx, "interactive"))
      ?.run;
  });

/** Обновить каталог из таблицы сейчас, не дожидаясь ночи. */
export const syncCatalogSheetFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  return (await (await import("@/core/catalog/sheet.server")).runSheetSync(ctx, "interactive"))
    ?.run;
});

/** Отключить таблицу: товары остаются как есть, ночные обновления прекращаются. */
export const disconnectCatalogSheetFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  const { SHEET_CONFIG_KEY, SHEET_STATUS_KEY } = await import("@/core/catalog/sheet");
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .in("key", [SHEET_CONFIG_KEY, SHEET_STATUS_KEY]);
  if (error) throw serverFailure(`Таблица каталога: не отключилась: ${error.message}`);
  return { ok: true };
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

/** Раскладка верхнего ряда категорий витрины (app_settings mini_app_catalog, формат v1). */
export const catalogLayoutFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { getSetting } = await import("@/core/settings/settings");
  const { parseCatalogLayout } = await import("@/core/storefront/categories");
  return parseCatalogLayout(await getSetting(ctx, "mini_app_catalog"));
});

export const saveCatalogLayoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        layout: z.enum(CATALOG_LAYOUTS),
        order: z.array(uuid).max(CATALOG_ORDER_MAX),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { setSetting } = await import("@/core/settings/settings");
    const order = [...new Set(data.order)];
    await setSetting(ctx, "mini_app_catalog", JSON.stringify({ layout: data.layout, order }));
    return { ok: true };
  });

/** Порядок перетаскиванием: товары страницы или соседние категории (core/catalog/reorder). */
export const reorderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        table: z.enum(["products", "categories"]),
        ids: z.array(z.string().uuid()).min(1).max(200),
        start: z.number().int().min(0).max(1e7).default(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { applyOrder } = await import("@/core/catalog/reorder");
    await applyOrder(ctx, data.table, data.ids, data.start);
    return { ok: true };
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
        offset: z.number().int().min(0).max(1_000_000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const m = await import("@/core/catalog/admin");
    const [page, categories] = await Promise.all([
      m.listProductsForAdmin(ctx, data),
      m.listAllCategories(ctx),
    ]);
    // «Хватит на N дней» (модуль «Склад»): только у товаров с остатком; нет продаж — null («—»).
    const { forecastFor } = await import("@/core/stock/forecast");
    const days = await forecastFor(
      ctx,
      page.rows
        .filter((p) => p.stock_quantity !== null)
        .map((p) => ({ id: p.id, name: p.name, stock: p.stock_quantity })),
    );
    const products = page.rows.map((p) => ({ ...p, days_left: days[p.id] ?? null }));
    return { products, total: page.total, hasMore: page.hasMore, categories };
  });

/**
 * Выбор товара в формах админки: поиск по названию (core/catalog/picker).
 * Названия товаров видит любой сотрудник — как и сам список товаров.
 */
export const productPickerFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().max(100).default(""),
        exclude: z.array(uuid).max(50).default([]),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { searchProducts } = await import("@/core/catalog/picker");
    return searchProducts(ctx, { q: data.q, exclude: data.exclude });
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
    // null — не удалось прочитать: «0 ждут» там было бы неправдой.
    const waitlistModule = await import("@/core/waitlist/waitlist");
    const waiting =
      data.id && ctx.tenant.modules.waitlist
        ? await waitlistModule.countWaiting(ctx, data.id).catch(() => null)
        : 0;
    const waitlistRun =
      data.id && ctx.tenant.modules.waitlist
        ? await waitlistModule.lastWaitlistRun(ctx, data.id).catch(() => null)
        : null;
    const low = ctx.tenant.modules.stock
      ? await (await import("@/core/catalog/low-stock")).loadThresholds(ctx, data.id)
      : { shop: 0, own: null };
    const preorder =
      data.id && ctx.tenant.modules.stock
        ? await (await import("@/core/preorder/preorder")).getPreorderRaw(ctx, data.id)
        : null;
    const preorderPast = preorder
      ? (await import("@/core/preorder/preorder")).preorderDatePast(preorder, ctx.timezone)
      : false;
    return {
      preorderPast,
      product,
      waiting,
      waitlistRun,
      lowStock: low,
      preorder,
      categories,
      countries: methods
        .filter((x) => x.is_active)
        .map((x) => ({ code: x.country_code, name: x.country_name, currency: x.currency })),
      defaultFulfillment: (await import("@/core/verticals/registry")).VERTICALS[ctx.tenant.vertical]
        .defaultFulfillment,
    };
  });

/** История остатка товара за 30 дней, страницами (блок в карточке товара). */
export const stockHistoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ productId: uuid, page: z.number().int().min(0).max(1000).default(0) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { listStockHistory } = await import("@/core/catalog/stock-history");
    return listStockHistory(ctx, data.productId, { page: data.page });
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
  /** Предупредить продавцу, когда остаток ≤ этого числа; null — порог магазина (core/catalog/low-stock). */
  lowStockAt: z.number().int().min(0).max(100_000).nullable().default(null),
  /** Предзаказ при нехватке остатка (core/preorder): только физический товар и модуль «Склад». */
  preorderOn: z.boolean().default(false),
  preorderFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /** Курс (модуль «Курсы»): уроки вместо файлов — файл не обязателен (core/courses/marker). */
  isCourse: z.boolean().default(false),
});

/** Пример цифрового товара: до 5 картинок (core/catalog/preview). */
export const productPreviewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { loadPreview } = await import("@/core/catalog/preview");
    return loadPreview(ctx, data.id);
  });

export const saveProductPreviewFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: uuid, keys: z.array(z.string().min(1).max(300)).max(5) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { savePreview } = await import("@/core/catalog/preview");
    return savePreview(ctx, data.id, data.keys);
  });

/** Товар-подписка: период продления в днях (модуль subscriptions); null — не подписка. */
export const productSubscriptionFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { loadSubscriptionDays } = await import("@/core/catalog/subscription");
    return { days: await loadSubscriptionDays(ctx, data.id) };
  });

export const saveProductSubscriptionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: uuid, days: z.number().int().min(7).max(365).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("subscriptions", "manager");
    const { saveSubscriptionDays } = await import("@/core/catalog/subscription");
    return { days: await saveSubscriptionDays(ctx, data.id, data.days) };
  });

export const saveProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid.nullable(), product: productInput }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    // Один бюджет на запрос: перенос предзаказа и лист ожидания идут друг за
    // другом, вместе они не должны выйти за предел функции (120 с).
    const { requestBudget } = await import("@/core/notify/budget");
    const budget = requestBudget();
    const m = await import("@/core/catalog/admin");
    const {
      images,
      materials,
      variants,
      isCourse,
      lowStockAt,
      preorderOn,
      preorderFrom,
      ...fields
    } = data.product;
    // Курс продаётся, когда у него появятся уроки: без них товар не попадёт
    // на витрину (core/courses/course.server syncCourseMarker).
    const course = isCourse && ctx.tenant.modules.courses;
    if (fields.fulfillmentKind === "digital" && materials.length === 0 && !course)
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
    if (ctx.tenant.modules.stock) {
      const { saveProductThreshold } = await import("@/core/catalog/low-stock");
      await saveProductThreshold(ctx, id, lowStockAt);
      const { savePreorder, getPreorderRaw } = await import("@/core/preorder/preorder");
      const preorderBefore = await getPreorderRaw(ctx, id);
      const preorderOnNow = preorderOn && fields.fulfillmentKind === "physical";
      await savePreorder(ctx, id, preorderOnNow ? { on: true, from: preorderFrom } : { on: false });
      // Срок отправки сдвинулся — покупатели с открытым заказом узнают об этом.
      const { isMove } = await import("@/core/preorder/reschedule");
      const preorderAfter = preorderOnNow ? await getPreorderRaw(ctx, id) : null;
      if (isMove(preorderBefore, preorderAfter)) {
        const { notifyPreorderMovedChannels } = await import("@/app/preorder/notify.server");
        await notifyPreorderMovedChannels(
          ctx,
          {
            productId: id,
            name: fields.name,
            from: preorderBefore!.from,
            to: preorderAfter!.from,
          },
          { budgetMs: budget.left() },
        ).catch((e) => console.error(`[admin:${ctx.tenant.id}] перенос предзаказа ${id}`, e));
      }
    }
    // История остатка: правка в карточке (у нового товара «было» — не учитывался).
    {
      const { recordStockChange } = await import("@/core/catalog/stock-history");
      await recordStockChange(
        ctx,
        { productId: id, from: before ? before.stock_quantity : null, to: fields.stockQuantity },
        { reason: "edit", actor: await actor() },
      );
    }
    const waitlist = await maybeNotifyWaitlist(ctx, id, before, budget.left());
    return { id, waitlist };
  });

async function stockState(ctx: TenantContext, id: string) {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select("is_active, stock_quantity, name")
    .eq("id", id)
    .maybeSingle();
  if (dataError) throw serverFailure(`Админка: ${dataError.message}`);
  return data;
}

/** Товар вернулся в продажу — лист ожидания получает сообщение (модуль waitlist). */
async function maybeNotifyWaitlist(
  ctx: TenantContext,
  id: string,
  before: Awaited<ReturnType<typeof stockState>> | null,
  budgetMs?: number,
) {
  if (!ctx.tenant.modules.waitlist || !before) return null;
  const after = await stockState(ctx, id);
  const { backInStock, inStock, lastWaitlistRun } = await import("@/core/waitlist/waitlist");
  if (!after) return null;
  if (!backInStock(before, after)) {
    // Прошлая рассылка не успела всех (вышел бюджет времени): товар в продаже —
    // досылаем оставшимся при следующем сохранении карточки.
    if (!inStock(after)) return null;
    const last = await lastWaitlistRun(ctx, id).catch(() => null);
    if (!last || last.left <= 0) return null;
  }
  const { notifyBackInStock } = await import("@/app/waitlist/notify.server");
  return notifyBackInStock(ctx, { id, name: after.name }, { budgetMs });
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

/** Массовые действия над выбранными товарами списка (core/catalog/bulk). */
export const bulkProductsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        ids: z.array(uuid).min(1).max(500),
        action: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("active"), active: z.boolean() }),
          z.object({
            kind: z.literal("category"),
            categoryId: uuid.nullable(),
            mode: z.enum(["add", "set"]),
          }),
          z.object({ kind: z.literal("price"), percent: z.number().min(-90).max(500) }),
          z.object({
            kind: z.literal("stock"),
            mode: z.enum(["set", "add"]),
            amount: z.number().int().min(0).max(1_000_000),
          }),
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    // Рассылки по товарам списка делят один бюджет запроса, он считается с начала
    // обработчика: само массовое действие тоже занимает время.
    const { requestBudget } = await import("@/core/notify/budget");
    const budget = requestBudget();
    const { bulkUpdateProducts } = await import("@/core/catalog/bulk");
    const r = await bulkUpdateProducts(ctx, data.ids, data.action, await actor());
    // Товары, вернувшиеся в продажу, будят лист ожидания — как одиночное «показать».
    if (data.action.kind === "active" && data.action.active && ctx.tenant.modules.waitlist)
      for (const id of r.changed) {
        const was = r.before.get(id);
        if (!was) continue;
        try {
          await maybeNotifyWaitlist(
            ctx,
            id,
            {
              is_active: false,
              stock_quantity: was.stock_quantity,
              name: was.name,
            },
            budget.left(),
          );
        } catch {
          // Уведомление — на лучшее усилие: товар уже показан.
        }
      }
    // Пополнение товара без остатка тоже будит лист ожидания — как правка остатка в карточке.
    if (data.action.kind === "stock" && ctx.tenant.modules.waitlist)
      for (const x of r.stock) {
        const was = r.before.get(x.id);
        if (!was) continue;
        try {
          await maybeNotifyWaitlist(
            ctx,
            x.id,
            {
              is_active: was.is_active,
              stock_quantity: x.from,
              name: was.name,
            },
            budget.left(),
          );
        } catch {
          // Уведомление — на лучшее усилие: остаток уже записан.
        }
      }
    return { changed: r.changed.length, skipped: r.skipped, stock: r.stock };
  });

/** Копия товара (core/catalog/copy): скрытая, без продаж и отзывов; суффикс названия — на языке продавца. */
export const copyProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: uuid, suffix: z.string().max(30).default("") }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { copyProduct } = await import("@/core/catalog/copy");
    return { id: await copyProduct(ctx, data.id, data.suffix) };
  });

/* ── заказы ──────────────────────────────────────────────────────── */

export const ordersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        status: z.string().optional(),
        q: z.string().optional(),
        pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
        unpaid: z.boolean().optional(),
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
    const { orderPageUrl, viewsOrderPage } = await import("@/core/storefront/web-order");
    const pageUrl = viewsOrderPage(order) ? await orderPageUrl(ctx, order.id) : null;
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
    const refundable = (REFUNDABLE_STATUSES as readonly string[]).includes(order.status)
      ? Math.max(0, Math.round((receivedAmount(order) - refunded) * 100) / 100)
      : 0;
    if (!accountant)
      return {
        order,
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
      };
    // Бухгалтеру: без контактов; журнал — только события и время, без текста.
    const { redactOrder, redactEventPayload } = await import("@/core/orders/redact");
    return {
      order: redactOrder(order),
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

/** Поиск по админке (⌘K): заказы, товары и покупатели по одной строке. */
export const adminSearchFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { ctx, accountant } = await finance();
    const orders = await import("@/core/orders/admin");
    const { accountantSearch, redactOrders } = await import("@/core/orders/redact");
    const { listProductsForAdmin } = await import("@/core/catalog/admin");
    const { displayNo } = await import("@/core/orders/pure");
    const q = accountant ? accountantSearch(data.q) : data.q;
    const [os, ps, cs] = await Promise.all([
      q ? orders.listOrdersForAdmin(ctx, { q, limit: 5 }) : Promise.resolve([]),
      listProductsForAdmin(ctx, { q: data.q }),
      // Бухгалтеру контакты покупателей не показываем — как в «Заказах».
      accountant ? Promise.resolve([]) : orders.listCustomers(ctx, data.q, 5),
    ]);
    return {
      orders: (accountant ? redactOrders(os) : os).map((o) => ({
        id: o.id,
        no: displayNo(o),
        name: o.display_name,
        status: o.status,
        total: Number(o.total),
        currency: o.currency,
      })),
      products: ps.rows.slice(0, 5).map((p) => ({ id: p.id, name: p.name })),
      customers: cs.map((c) => ({
        key: c.user_key,
        name:
          [c.first_name, c.last_name].filter(Boolean).join(" ") ||
          (c.username ? `@${c.username}` : c.user_key),
        platform: c.platform,
        phone: c.contact_phone,
      })),
    };
  });

/* ── покупатели ──────────────────────────────────────────────────── */

export const customersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await admin();
    return (await import("@/core/orders/admin")).listCustomers(ctx, data.q);
  });

/** Карточка покупателя: профиль, заказы, обращения, заявки, чат, теги и заметка продавца. */
export const customerCardFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ key: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { customerCard, knownTags } = await import("@/core/customers/card");
    const [card, tags] = await Promise.all([customerCard(ctx, data.key), knownTags(ctx)]);
    if (!card) throw new UserError("err.customer.notFound", "Покупатель не найден.");
    return { card, tags };
  });

/** Теги и заметка продавца о покупателе (слиянием в bot_users.metadata). */
export const saveCustomerNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.string().min(1).max(200),
        tags: z.array(z.string().max(100)).max(50),
        note: z.string().max(4000),
        // Версия заметки из последнего чтения (null — заметки не было); идёт в условие записи.
        version: z.string().datetime({ offset: true }).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { setSellerNote } = await import("@/core/customers/card");
    const r = await setSellerNote(
      ctx,
      data.key,
      { tags: data.tags, note: data.note },
      data.version,
    );
    if (!r) throw new UserError("err.customer.notFound", "Покупатель не найден.");
    // saved: false — заметку успели изменить; в ответе актуальная, форма показывает её и просит проверить.
    return r;
  });

/** «Это тот же человек»: ручная связь двух профилей покупателя (core/customers/identity). */
export const linkCustomerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.string().min(1).max(200), other: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { linkProfiles } = await import("@/core/customers/identity");
    if (!(await linkProfiles(ctx, data.key, data.other)))
      throw new UserError("err.customer.notFound", "Покупатель не найден.");
    return { ok: true };
  });

export const unlinkCustomerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.string().min(1).max(200), other: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { unlinkProfiles } = await import("@/core/customers/identity");
    await unlinkProfiles(ctx, data.key, data.other);
    return { ok: true };
  });

/** День рождения покупателя из карточки (core/funnel/birthday); пусто — убрать. */
export const saveCustomerBirthdayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.string().min(1).max(200), birthday: z.string().max(20) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { parseBirthday, setCustomerBirthday } = await import("@/core/funnel/birthday");
    const day = data.birthday.trim() ? parseBirthday(data.birthday) : null;
    if (data.birthday.trim() && !day)
      throw new UserError("err.customer.badBirthday", "Не разобрал дату — например 15.03");
    const { getCustomer } = await import("@/core/customers/customers");
    const c = await getCustomer(ctx, data.key);
    if (!c) throw new UserError("err.customer.notFound", "Покупатель не найден.");
    await setCustomerBirthday(ctx, c, day);
    return { birthday: day };
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

export const settingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const role = await (await import("@/app/auth/guards.server")).adminRole();
  const { getSettings } = await import("@/core/settings/settings");
  const { listPaymentMethods } = await import("@/core/settings/payment-methods");
  const [raw, methods] = await Promise.all([
    getSettings(ctx, SETTING_KEYS),
    listPaymentMethods(ctx),
  ]);
  const settings = settingsForRole(raw, role);
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
  .validator((d: unknown) =>
    z.record(z.enum(WRITABLE_SETTING_KEYS), z.string().max(LEGAL_TEXT_MAX)).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const tooLong = firstTooLongSetting(data);
    if (tooLong)
      throw new UserError(
        "err.settings.tooLong",
        "Текст в поле «{field}» слишком длинный: {length} символов, допустимо не больше {max}.",
        { field: tooLong.key, length: tooLong.length, max: tooLong.max },
      );
    const { setSetting } = await import("@/core/settings/settings");
    // Нерабочие дни выдачи пишутся в каноничном виде: прошедшие отрезки уходят,
    // переполнение — отказ (мусор отсеивает разбор).
    const { parseClosedWeekdays, prepareClosedDates, MAX_CLOSED_ENTRIES } =
      await import("@/core/fulfillment/closed-days");
    const { parseLimit } = await import("@/core/fulfillment/capacity");
    const out: Record<string, string> = { ...data };
    if (data.fulfillment_closed_weekdays !== undefined)
      out.fulfillment_closed_weekdays = parseClosedWeekdays(data.fulfillment_closed_weekdays).join(
        ",",
      );
    if (data.fulfillment_closed_dates !== undefined) {
      const { todayInTz } = await import("@/core/fulfillment/pure");
      const r = prepareClosedDates(data.fulfillment_closed_dates, todayInTz(ctx.timezone));
      if (!r.ok) {
        const { adminTFor } = await import("./locale.server");
        throw shownError(
          (await adminTFor(ctx))("settings.ful.closedTooMany", { max: MAX_CLOSED_ENTRIES }),
        );
      }
      out.fulfillment_closed_dates = r.value;
    }
    for (const key of ["fulfillment_day_limit", "fulfillment_slot_limit"] as const)
      if (data[key] !== undefined) out[key] = String(parseLimit(data[key]) ?? "");
    for (const [k, v] of Object.entries(out)) await setSetting(ctx, k, v);
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

/**
 * «Забрать мои данные»: ссылка на архив магазина на 24 часа. Только владелец:
 * в архиве контакты покупателей. Сам архив собирает /api/takeout/<магазин>.
 */
export const takeoutLinkFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminOwner();
  const [{ env }, { takeoutLink }] = await Promise.all([
    import("@/config/env"),
    import("@/core/export/takeout"),
  ]);
  const { path, expiresAt } = takeoutLink(env().SESSION_SECRET, ctx.tenant.id);
  return { url: `${ctx.appUrl.replace(/\/$/, "")}${path}`, expiresAt };
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
  const { data: pending, error: pendingError } = await ctx.db
    .from("module_requests")
    .select("module_key")
    .eq("status", "pending");
  if (pendingError) throw serverFailure(`Админка: ${pendingError.message}`);
  const billing = ctx.tenant.settings.billing ?? {};
  return {
    plan: plan?.kind === "tier" ? plan.tier : plan?.kind === "custom" ? ("custom" as const) : null,
    hasTiers: Boolean(nicheForVertical(ctx.tenant.vertical)),
    period: billing.period ?? "month",
    trialUntil: billing.trial_until ?? null,
    /** Срок оплаченной подписки: до какого дня и что будет (null — срок не заведён). */
    subscription: (await trialBanner(ctx)) ? null : await subscriptionView(ctx),
    addons: billing.addons ?? [],
    availableAddons: ADDON_KEYS,
    prices: { monthly: MONTHLY_PRICE, connection: CONNECTION_PRICE },
    usage: planUsage(ctx.tenant, values),
    pending: (pending ?? []).map((r) => r.module_key),
  };
});

/** «История оплат» в «Ваш план»: платежи или счета подписки, постранично. Видит и бухгалтер. */
export const billingHistoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ kind: z.enum(["payments", "invoices"]), page: z.number().int().min(0).max(10_000) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx } = await finance();
    const { billingHistory } = await import("./billing-history.server");
    return data.kind === "payments"
      ? {
          kind: "payments" as const,
          ...(await billingHistory(ctx.tenant.id, "payments", data.page)),
        }
      : {
          kind: "invoices" as const,
          ...(await billingHistory(ctx.tenant.id, "invoices", data.page)),
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
  const r = await syncAccounts(ctx.tenant);
  // Новый аккаунт Instagram получает быстрые вопросы сразу, а не с кроном.
  const { refreshIceBreakers } = await import("@/channels/zernio/ice-breakers.server");
  await refreshIceBreakers(ctx.tenant.id);
  return r;
});

/**
 * Отключить Instagram или WhatsApp от магазина (только владелец): бот
 * перестаёт отвечать и слать в этот аккаунт, можно подключить другой.
 * Переписка, заказы и покупатели остаются.
 */
export const disconnectZernioAccountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { disconnectAccount } = await import("@/channels/zernio/connect.server");
    return disconnectAccount(ctx.tenant, data.accountId);
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
  const { listPromoCodes } = await import("@/core/discounts/lists");
  const { promoOnceIds } = await import("@/core/discounts/promo-once");
  const [list, once] = await Promise.all([listPromoCodes(ctx), promoOnceIds(ctx)]);
  return list.map((p) => ({ ...p, once_per_buyer: once.has(p.id) }));
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
        oncePerBuyer: z.boolean().optional(),
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
      ? ctx.db.from("promo_codes").update(row).eq("id", data.id).select("id").maybeSingle()
      : ctx.db
          .from("promo_codes")
          .insert({ bot_id: ctx.tenant.id, ...row })
          .select("id")
          .maybeSingle();
    const { data: saved, error } = await q;
    if (error)
      throw /duplicate|unique/i.test(error.message)
        ? new UserError("err.admin.codeTaken", "Такой код уже есть.")
        : new Error(error.message);
    // «Один раз на покупателя» — список id в app_settings (схема не меняется).
    if (saved && data.oncePerBuyer !== undefined) {
      const { setPromoOnce } = await import("@/core/discounts/promo-once");
      if (!(await setPromoOnce(ctx, saved.id, data.oncePerBuyer)))
        throw serverFailure(`[promo] флаг «один раз на покупателя» для ${saved.id} не записан`);
    }
    return { ok: true };
  });

export const deletePromoCodeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { error } = await ctx.db.from("promo_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const { setPromoOnce } = await import("@/core/discounts/promo-once");
    await setPromoOnce(ctx, data.id, false);
    return { ok: true };
  });

export const giftCertificatesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { listGiftCertificates } = await import("@/core/discounts/lists");
  return listGiftCertificates(ctx);
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

/** Продажа сертификатов на витрине сайта: включена ли, номиналы и валюта (bots.settings.gift_sale). */
export const giftSaleFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { giftSaleSettings } = await import("@/core/discounts/gift-sale");
  return giftSaleSettings(ctx);
});

export const saveGiftSaleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        amounts: z.array(z.number().int().positive().max(10_000_000)).max(6),
        currency: z.string().regex(/^[A-Za-z]{3}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("gift_certificates", "manager");
    const { normalizeGiftAmounts } = await import("@/core/discounts/gift-sale");
    const amounts = normalizeGiftAmounts(data.amounts);
    if (data.enabled && amounts.length === 0)
      throw new UserError("err.admin.giftSaleAmounts", "Укажите хотя бы один номинал.");
    const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
    await patchTenantSettings(ctx.tenant.id, {
      gift_sale: { enabled: data.enabled, amounts, currency: data.currency.toUpperCase() },
    });
    return { ok: true };
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
/** Сегмент аудитории (core/broadcasts/segments); разбирается parseSegment, мусор — без сегмента. */
const segmentSchema = z.record(z.string(), z.unknown()).optional();
/** Отложенная отправка: не раньше чем через минуту и не позже 60 дней. */
const MAX_SCHEDULE_MS = 60 * 24 * 3600_000;

/** Аккаунты WhatsApp клиента из снимка Zernio — от чьего имени идёт рассылка шаблонами. */
function whatsAppAccountsOf(ctx: TenantContext) {
  return (ctx.tenant.settings.zernio?.accounts ?? [])
    .filter((a) => a.platform === "whatsapp" && !a.expired)
    .map((a) => ({ id: a.id, name: a.name ?? a.username ?? a.id }));
}

/** Клики и «принесла» к рассылкам страницы истории. */
async function withBroadcastStats(
  ctx: TenantContext,
  rows: Awaited<ReturnType<typeof import("@/core/broadcasts/broadcasts").listBroadcasts>>["rows"],
) {
  const { clicksFor } = await import("@/core/broadcasts/clicks");
  const { revenueFor, EMPTY_REVENUE } = await import("@/core/broadcasts/revenue");
  const clicks = await clicksFor(
    ctx,
    rows.filter((b) => b.channel !== "whatsapp").map((b) => b.id),
  );
  const revenue = await revenueFor(
    ctx,
    rows.filter((b) => b.sent_count > 0).map((b) => b.id),
  );
  return rows.map((b) => ({
    ...b,
    clicks: clicks[b.id] ?? 0,
    revenue: revenue[b.id] ?? EMPTY_REVENUE,
  }));
}

/** Следующая страница истории рассылок («Показать ещё»). */
export const moreBroadcastsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ offset: z.number().int().min(0).max(100000) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminAnyModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminAnyModule("broadcasts", "wa_broadcasts");
    const { listBroadcasts } = await import("@/core/broadcasts/broadcasts");
    const page = await listBroadcasts(ctx, data.offset);
    return { broadcasts: await withBroadcastStats(ctx, page.rows), total: page.total };
  });

export const broadcastsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdminAnyModule } = await import("@/app/auth/guards.server");
  const ctx = await requireAdminAnyModule("broadcasts", "wa_broadcasts");
  const { listBroadcasts, audienceCountries } = await import("@/core/broadcasts/broadcasts");
  const { getSettings } = await import("@/core/settings/settings");
  const { listTemplates, templateBody, templateParamCount } =
    await import("@/core/whatsapp/templates");
  const wa = ctx.tenant.modules.wa_broadcasts;
  const { pageAll } = await import("@/core/db/page");
  // Товары для кнопок и сегмента выбираются поиском (productPickerFn), не списком.
  const [broadcasts, countries, settings, templates, categories] = await Promise.all([
    listBroadcasts(ctx),
    audienceCountries(ctx),
    getSettings(ctx, [
      "cart_reminder_hours",
      "marketing_daily_cap",
      "admin_chat_id",
      "whatsapp_bot_excluded_phones",
    ]),
    wa ? listTemplates(ctx) : Promise.resolve([]),
    pageAll(
      (from, to) =>
        ctx.db
          .from("categories")
          .select("id, name")
          .order("sort_order")
          .order("name")
          .order("id")
          .range(from, to),
      "Категории для рассылки",
    ),
  ]);
  // Итоги автосообщений нужны только карточкам включённых модулей.
  const { autoMessageStats } = await import("@/core/automsg/stats");
  const autoStats =
    ctx.tenant.modules.cart_reminder || ctx.tenant.modules.winback || ctx.tenant.modules.waitlist
      ? await autoMessageStats(ctx)
      : null;
  const { engageStats } = await import("@/core/automsg/engage");
  const engage =
    ctx.tenant.modules.quiz || ctx.tenant.modules.upsell ? await engageStats(ctx) : null;
  return {
    broadcasts: await withBroadcastStats(ctx, broadcasts.rows),
    broadcastsTotal: broadcasts.total,
    autoStats,
    engage,
    categories,
    countries,
    cartReminderHours: settings.cart_reminder_hours ?? "",
    marketingCap: settings.marketing_daily_cap ?? "",
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
        segment: segmentSchema,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const { parseSegment } = await import("@/core/broadcasts/segments");
    const segment = data.channel === "telegram" ? parseSegment(data.segment) : null;
    const filter = { country_code: data.countryCode, ...(segment ? { segment } : {}) };
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
        /** A/B-тест: второй текст — половине аудитории (core/broadcasts/ab). */
        textB: z.string().max(4000).optional(),
        photoKeys: z.array(z.string().min(1).max(300)).max(10).default([]),
        productIds: z.array(uuid).max(8).default([]),
        showCatalog: z.boolean().default(false),
        /** Кнопка «Участвовать» под сообщением (модуль giveaways). */
        giveawayId: z
          .string()
          .regex(/^[a-z0-9]{8}$/)
          .optional(),
        audience: audienceSchema,
        countryCode: z.string().max(3).optional(),
        segment: segmentSchema,
        sendAt: z.string().datetime().optional(),
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
      const { data: tpl, error: tplError } = await ctx.db
        .from("whatsapp_templates")
        .select("status, components")
        .eq("account_id", data.whatsapp.accountId)
        .eq("name", data.whatsapp.templateName)
        .eq("language", data.whatsapp.templateLanguage)
        .maybeSingle();
      if (tplError) throw serverFailure(`Админка: ${tplError.message}`);
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
    const { parseSegment } = await import("@/core/broadcasts/segments");
    const segment =
      data.channel === "telegram" && data.audience === "all" ? parseSegment(data.segment) : null;
    if (data.segment && data.audience === "all" && data.channel === "telegram" && !segment)
      throw new UserError("err.broadcast.badSegment", "Сегмент заполнен не полностью.");
    let sendAt: string | undefined;
    if (data.sendAt && data.audience !== "test") {
      const at = Date.parse(data.sendAt);
      if (at < Date.now() + 60_000 || at > Date.now() + MAX_SCHEDULE_MS)
        throw new UserError(
          "err.broadcast.badSchedule",
          "Время отправки — от минуты до 60 дней вперёд.",
        );
      sendAt = new Date(at).toISOString();
    }
    let giveawayId: string | undefined;
    if (data.giveawayId && data.channel === "telegram") {
      if (!ctx.tenant.modules.giveaways)
        throw new UserError(
          "err.auth.moduleOff",
          "Модуль «{module}» не подключён к вашему тарифу.",
          { module: "giveaways" },
        );
      const { getGiveaway, isAccepting } = await import("@/core/giveaways/giveaway");
      const g = await getGiveaway(ctx, data.giveawayId);
      if (!g) throw new UserError("err.giveaway.notFound", "Розыгрыш не найден.");
      if (g.channel === "instagram")
        throw new UserError(
          "err.giveaway.instagramOnly",
          "Этот розыгрыш проходит только в Instagram.",
        );
      if (!isAccepting(g, new Date()))
        throw new UserError("err.giveaway.notOpen", "Приём закрыт — условия уже не меняются.");
      giveawayId = g.id;
    }
    const filter = {
      ...(data.countryCode ? { country_code: data.countryCode } : {}),
      ...(segment ? { segment } : {}),
      ...(sendAt ? { send_at: sendAt } : {}),
      ...(giveawayId ? { giveaway_id: giveawayId } : {}),
    };
    const base = {
      channel: data.channel,
      text: data.text,
      photoKeys: data.photoKeys,
      productIds: data.productIds,
      showCatalog: data.showCatalog,
      audience: data.audience,
      filter: Object.keys(filter).length ? filter : undefined,
      whatsapp: data.whatsapp,
    };
    const textB = data.textB?.trim();
    if (textB && data.channel === "telegram" && data.audience !== "test") {
      // A/B: вариант A — в срок, B — следом (две рассылки канала сразу не идут).
      const { newAbGroup } = await import("@/core/broadcasts/ab");
      const group = newAbGroup();
      const a = await createBroadcast(ctx, {
        ...base,
        filter: { ...filter, ab: { group, half: 0, variant: "A" } },
      });
      if (!a.ok) throw new Error(a.message);
      const bAt = Math.max(Date.parse(sendAt ?? "") || 0, Date.now() + 65_000);
      const b = await createBroadcast(ctx, {
        ...base,
        text: textB,
        filter: {
          ...filter,
          ab: { group, half: 1, variant: "B" },
          send_at: new Date(bAt).toISOString(),
        },
      });
      if (!b.ok) {
        const { cancelBroadcast } = await import("@/core/broadcasts/broadcasts");
        await cancelBroadcast(ctx, a.broadcast.id);
        throw new Error(b.message);
      }
      return {
        id: a.broadcast.id,
        total: a.broadcast.total_count + b.broadcast.total_count,
      };
    }
    const r = await createBroadcast(ctx, base);
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
    const { ctx } = await finance();
    const now = new Date();
    const from = new Date(now.getTime() - data.days * 86_400_000);
    const funnels = await import("@/core/analytics/funnel.server");
    const [a, funnel, sources, cohorts, customers, speed, sales, giftsBundles] = await Promise.all([
      (await import("@/core/analytics/analytics")).analytics(ctx, data.days),
      funnels.buyerFunnel(ctx, from, now),
      funnels.sourceFunnel(ctx, from, now),
      (await import("@/core/analytics/cohorts.server")).cohorts(ctx, now),
      (await import("@/core/analytics/customers.server")).customersBlock(ctx, data.days, now),
      (await import("@/core/analytics/speed.server")).speedStats(ctx, from, now),
      (await import("@/core/analytics/sales.server")).saleResults(ctx, now),
      (await import("@/core/analytics/bundles.server")).bundleGiftResults(ctx, data.days, now),
    ]);
    const { storefrontOpen } = await import("@/core/storefront/access");
    const { storefrontBase } = await import("@/core/tenant/custom-domain");
    /** Куда ведут ссылки с меткой (core/analytics/source-links). */
    const links = {
      bot: ctx.tenant.telegramTokenEnc ? (ctx.tenant.settings.telegram?.username ?? null) : null,
      store:
        ctx.tenant.settings.slug && storefrontOpen(ctx.tenant, "catalog")
          ? storefrontBase(ctx.tenant, ctx.appUrl)
          : null,
    };
    return {
      ...a,
      funnel,
      sources,
      links,
      cohorts,
      customers,
      speed,
      sales,
      giftsBundles,
      timezone: ctx.timezone,
    };
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

const inboxFilterSchema = z.object({
  status: z.enum(["open", "closed", "all"]),
  who: z.enum(["mine", "none", "all"]),
  channel: z.enum(["telegram", "instagram", "whatsapp", "all"]),
  unread: z.boolean().optional(),
  search: z.string().max(100).optional(),
});
const DEFAULT_INBOX_FILTER = { status: "open", who: "all", channel: "all" } as const;
// Граница идёт в or() PostgREST — только строгие форматы.
const isoTime = z.string().datetime({ offset: true });
const conversationCursor = z.object({
  last_message_at: isoTime,
  telegram_id: tgId,
});

/**
 * Единый входящий: первая страница диалогов (по умолчанию открытые) со счётчиками
 * и всем, что страница знает о магазине: команда, быстрые ответы, срок «без ответа».
 */
export const chatConversationsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ filter: inboxFilterSchema.optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const inbox = await import("@/core/inbox/inbox");
    const { listInboxPage, inboxTotals } = await import("@/core/inbox/page");
    const { getSetting } = await import("@/core/settings/settings");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const { UNANSWERED_KEY, UNANSWERED_ESCALATE_KEY, parseUnansweredMinutes, parseEscalate } =
      await import("@/core/chat/unanswered");
    const me = (await adminIdentity())?.username ?? "";
    const filter = data.filter ?? DEFAULT_INBOX_FILTER;
    // Граница опроса берётся до чтения, с запасом на расхождение часов приложения и базы.
    const asOf = new Date(Date.now() - 60_000).toISOString();
    const [page, totals, rawReplies, rawUnanswered, rawEscalate] = await Promise.all([
      listInboxPage(ctx, { filter, me }),
      inboxTotals(ctx, me),
      getSetting(ctx, inbox.QUICK_REPLIES_KEY),
      getSetting(ctx, UNANSWERED_KEY),
      getSetting(ctx, UNANSWERED_ESCALATE_KEY),
    ]);
    return {
      conversations: page.items,
      hasMore: page.hasMore,
      next: page.next,
      totals,
      asOf,
      me,
      assignees: inbox.inboxAssignees(ctx),
      quickReplies: inbox.parseQuickReplies(rawReplies),
      unansweredMinutes: parseUnansweredMinutes(rawUnanswered),
      unansweredEscalate: parseEscalate(rawEscalate),
    };
  });

/** Следующая (или первая под новый фильтр/поиск) страница списка диалогов и счётчики. */
export const chatInboxPageFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ filter: inboxFilterSchema, before: conversationCursor.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listInboxPage, inboxTotals } = await import("@/core/inbox/page");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const me = (await adminIdentity())?.username ?? "";
    const [page, totals] = await Promise.all([
      listInboxPage(ctx, { filter: data.filter, me, before: data.before }),
      inboxTotals(ctx, me),
    ]);
    return { conversations: page.items, hasMore: page.hasMore, next: page.next, totals };
  });

/** Поиск по тексту переписки: находки страницами, свежие сверху. Ничего не отмечает прочитанным. */
export const chatSearchFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().trim().min(SEARCH_MIN).max(100),
        // Граница идёт в or() PostgREST — только строгие форматы.
        before: z.object({ created_at: isoTime, id: z.string().uuid() }).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { searchMessages } = await import("@/core/chat/search");
    return searchMessages(ctx, data.q, { before: data.before });
  });

/** Боковая панель диалога: заказы, сумма покупок, баллы и обращения покупателя. Контактов нет. */
export const chatCustomerPanelFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { customerPanel } = await import("@/core/customers/panel");
    return customerPanel(ctx, data.telegramId);
  });

/**
 * Опрос: диалоги, менявшиеся с `since` (новая реплика, статус, ответственный),
 * счётчики и открытый в окне диалог (`selected`: его пауза бота и «вы в чате»
 * меняются без новых реплик). `unread` — сколько непрочитанных клиент знал в
 * прошлый раз: если число сдвинулось, приходит список диалогов с непрочитанным
 * (`unreadIds`), чтобы снять отметку у тех, кого прочитал коллега. `asOf` — граница
 * для следующего опроса (с запасом на расхождение часов приложения и базы).
 */
export const chatInboxPollFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        since: isoTime,
        selectedId: tgId.optional(),
        unread: z.number().int().min(0).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listInboxChanged, inboxTotals, getInboxItem } = await import("@/core/inbox/page");
    const { listUnreadIds } = await import("@/core/chat/chat");
    const { adminIdentity } = await import("@/app/auth/guards.server");
    const me = (await adminIdentity())?.username ?? "";
    const asOf = new Date(Date.now() - 60_000).toISOString();
    const [changed, totals, selected] = await Promise.all([
      listInboxChanged(ctx, data.since),
      inboxTotals(ctx, me),
      data.selectedId === undefined ? null : getInboxItem(ctx, data.selectedId),
    ]);
    const unreadIds =
      data.unread !== undefined && data.unread !== totals.unread ? await listUnreadIds(ctx) : null;
    return { changed, totals, selected, asOf, unreadIds };
  });

/**
 * Быстрый ответ с подстановками ({name}, {order}, {ticket}) для выбранного
 * покупателя — одно место для «Чата» и «Обращений». Только читает: ничего не отправляет.
 */
export const quickReplyFillFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        text: z.string().max(2000),
        ticketNo: z.number().int().positive().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { quickReplyVars, fillQuickReply } = await import("@/core/inbox/inbox");
    return {
      text: fillQuickReply(data.text, await quickReplyVars(ctx, data.telegramId, data.ticketNo)),
    };
  });

/**
 * Через сколько минут без ответа напомнить продавцу; 0 — не напоминать.
 * `escalate` — второй шаг владельцу; без поля настройка второго шага не меняется.
 */
export const chatUnansweredSaveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ minutes: z.number().int().min(0).max(1440), escalate: z.boolean().optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { UNANSWERED_KEY, UNANSWERED_ESCALATE_KEY, parseUnansweredMinutes } =
      await import("@/core/chat/unanswered");
    const minutes = parseUnansweredMinutes(String(data.minutes));
    const { setSetting } = await import("@/core/settings/settings");
    await setSetting(ctx, UNANSWERED_KEY, String(minutes));
    if (data.escalate !== undefined)
      await setSetting(ctx, UNANSWERED_ESCALATE_KEY, data.escalate ? "1" : "0");
    return { minutes, escalate: data.escalate };
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
    const { setInboxMeta, inboxAssignees } = await import("@/core/inbox/inbox");
    if (data.assignee && !inboxAssignees(ctx).some((a) => a.username === data.assignee))
      throw new UserError("err.admin.inboxAssignee", "Такого пользователя нет в команде магазина.");
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
    const { listMessages, markRead, lastInboundAt } = await import("@/core/chat/chat");
    const [page, inboundAt] = await Promise.all([
      listMessages(ctx, data.telegramId),
      lastInboundAt(ctx, data.telegramId),
    ]);
    await markRead(ctx, data.telegramId);
    // Окно 24 часа Instagram/WhatsApp считается от последнего входящего, отдельным
    // запросом: в последней странице переписки его может не оказаться.
    // serverNow — остаток окна браузер считает по часам сервера, не по своим.
    // Шаблон WhatsApp для ответа вне окна: поле ответа заранее говорит, уйдёт ли сообщение.
    const { getSetting } = await import("@/core/settings/settings");
    const { parseNotifyTemplate } = await import("@/channels/zernio/outbox.server");
    const template = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
    return {
      messages: page.messages,
      hasMore: page.hasMore,
      lastInboundAt: inboundAt,
      serverNow: new Date().toISOString(),
      waTemplate: template?.name ?? null,
    };
  });

/** «Показать раньше»: страница переписки до указанного сообщения; прочитанным не отмечает. */
export const chatEarlierFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
        // Граница идёт в or() PostgREST — только строгие форматы.
        before: z.object({
          created_at: z.string().datetime({ offset: true }),
          id: z.string().uuid(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule();
    const { listMessages } = await import("@/core/chat/chat");
    return listMessages(ctx, data.telegramId, { before: data.before });
  });

/**
 * Товары для счёта из диалога: поиск по названию, по 30 штук — у крупного
 * магазина каталог в тысячи позиций, и список целиком форме не нужен.
 */
export const invoiceProductsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().max(100).default("") }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    let q = ctx.db
      .from("products")
      .select(
        "id, name, price, currency, fulfillment_kind, product_variants(id, name, price, sort_order)",
      )
      .eq("is_active", true);
    const term = data.q.trim().replace(/[%_,()]/g, " ");
    if (term) q = q.ilike("name", `%${term}%`);
    const { data: rows, error } = await q.order("sort_order").order("name").limit(INVOICE_PAGE);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      currency: p.currency,
      physical: p.fulfillment_kind === "physical",
      variants: [...(p.product_variants ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => ({ id: v.id, name: v.name, price: Number(v.price) })),
    }));
  });
const INVOICE_PAGE = 30;

/** Сколько позиций уже в корзине покупателя — продавца предупреждаем до замены. */
export const invoiceCartFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { count, error: countError } = await ctx.db
      .from("cart_items")
      .select("id", { count: "exact", head: true })
      .eq("telegram_id", data.telegramId);
    if (countError) throw serverFailure(`Админка: ${countError.message}`);
    return { count: count ?? 0 };
  });

/**
 * Можно ли выставить счёт в каждом канале и как (app/admin/invoice.server):
 * кнопкой в канале, ссылкой на страницу заказа на сайте или никак. Есть ли у
 * магазина адрес витрины — для подсказки, как включить оплату на сайте.
 */
export const chatInvoiceModesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async () => {
    const ctx = await chatModule("manager");
    const { invoiceMode } = await import("./invoice.server");
    return {
      telegram: await invoiceMode(ctx, "telegram"),
      instagram: await invoiceMode(ctx, "instagram"),
      whatsapp: await invoiceMode(ctx, "whatsapp"),
      storefront: Boolean(ctx.tenant.settings.slug),
    };
  });

/** «Выставить счёт»: корзина покупателю и кнопка «Оформить заказ» (или ссылка на оплату на сайте) в его канал. */
export const chatInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: tgId,
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
        /** true — дописать к корзине покупателя, false — заменить её счётом. */
        append: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { sendDialogInvoice } = await import("./invoice.server");
    return sendDialogInvoice(ctx, data.telegramId, data.items, { append: data.append });
  });

/** Консультант снова отвечает в диалоге, не дожидаясь конца паузы. */
export const chatResumeBotFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ telegramId: tgId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { getCustomerByTelegramId } = await import("@/core/customers/customers");
    const c = await getCustomerByTelegramId(ctx, data.telegramId);
    if (c) await (await import("@/core/consultant/engine.server")).resumeConsultant(ctx, c);
    return { ok: true };
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
    z
      .object({
        telegramId: tgId,
        text: z.string().trim().max(4000),
        // Фото или документ, уже загруженные через /api/admin/upload.
        attachment: z
          .object({
            kind: z.enum(["photo", "file"]),
            key: z.string().min(1).max(200),
            name: z.string().max(255).default(""),
          })
          .optional(),
        draftId: z.string().uuid().optional(),
      })
      .refine((v) => v.text.length > 0 || v.attachment, { message: "empty reply" })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await chatModule("manager");
    const { replyAsManager, pauseBotAfterManagerReply } = await import("./admin.server");
    await replyAsManager(ctx, data.telegramId, data.text, data.attachment, data.draftId);
    // Ответил человек — консультант не перебивает его на выбранное продавцом время.
    await pauseBotAfterManagerReply(ctx, data.telegramId);
    // Ничей диалог достаётся тому, кто ответил первым.
    const { adminIdentity, adminActor } = await import("@/app/auth/guards.server");
    const inbox = await import("@/core/inbox/inbox");
    const me = await adminIdentity();
    if (me) await inbox.claimOnReply(ctx, data.telegramId, me.username, await adminActor());
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
  const { pauseHours } = await import("@/core/consultant/pause");
  return {
    ...c,
    configured: consultantConfigured(),
    usage,
    lastError: s[KEYS.lastError] ?? "",
    pauseHours: pauseHours(ctx.tenant),
  };
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
        pauseHours: z
          .union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(0)])
          .optional(),
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
    if (
      data.pauseHours !== undefined &&
      data.pauseHours !== ctx.tenant.settings.consultant_pause_hours
    ) {
      // В bots.settings: пауза читается из контекста арендатора на каждом сообщении без похода в app_settings.
      const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
      await patchTenantSettings(ctx.tenant.id, { consultant_pause_hours: data.pauseHours });
    }
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
