import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: рассылки и шаблоны WhatsApp.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const uuid = z.string().uuid();

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
