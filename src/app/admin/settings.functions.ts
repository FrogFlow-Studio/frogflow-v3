import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shownError } from "@/lib/shown-error";
import { serverFailure } from "@/lib/server-failure";
import { MODULE_KEYS } from "@/core/modules/registry";
import { UserError } from "@/core/i18n/user-error";
import {
  firstTooLongSetting,
  LEGAL_TEXT_MAX,
  SETTING_KEYS,
  settingsForRole,
  WRITABLE_SETTING_KEYS,
} from "./setting-keys";

/**
 * Админка продавца: настройки магазина, способы оплаты, модули, выгрузка и приглашение.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

const adminOwner = async () => (await import("@/app/auth/guards.server")).requireAdminRole("owner");

/** Настройки магазина — владельцу и администратору; тариф, платежи, команда и удаление — только владельцу. */
const adminLevel = async () => (await import("@/app/auth/guards.server")).requireAdminRole("admin");

const uuid = z.string().uuid();

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
  const { recentSettingKeys } = await import("@/core/settings/settings");
  // Порядок «изменено недавно» — удобство: сбой чтения не роняет страницу настроек.
  const recentKeys = await recentSettingKeys(ctx, SETTING_KEYS).catch((e) => {
    console.warn(`[settings:${ctx.tenant.id}] недавно изменённые: ${String(e)}`);
    return [] as string[];
  });
  const { platformHasKey } = await import("@/core/search/smart.server");
  const { visionConfigured } = await import("@/core/receipts/verify.server");
  return {
    settings,
    methods,
    ownerTelegramId: ctx.tenant.ownerTelegramId,
    timezone: ctx.tenant.settings.timezone ?? null,
    pdfWatermark: ctx.tenant.settings.delivery?.pdf_watermark === true,
    recentKeys,
    smartSearchKey: platformHasKey(),
    visionKey: visionConfigured(),
  };
});

/** Часовой пояс магазина — в bots.settings: его читает контекст арендатора без похода в app_settings. */
export const setShopTimezoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ timezone: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
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
    const ctx = await adminLevel();
    const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
    await patchTenantSettings(ctx.tenant.id, { delivery: { pdf_watermark: data.enabled } });
    return { ok: true, enabled: data.enabled };
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.record(z.enum(WRITABLE_SETTING_KEYS), z.string().max(LEGAL_TEXT_MAX)).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    // Платежи — только владельцу: администратору их ключи и режимы записывать нельзя.
    const { adminRole } = await import("@/app/auth/guards.server");
    if ((await adminRole()) !== "owner") {
      const { PAYMENT_SETTING_KEYS } = await import("./setting-keys");
      if (Object.keys(data).some((k) => PAYMENT_SETTING_KEYS.has(k)))
        throw new UserError("err.auth.ownerOnly", "Это может изменить только владелец магазина.");
    }

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
    if (data.weekly_report_sections !== undefined) {
      const { parseWeeklySections, serializeWeeklySections } =
        await import("@/core/analytics/weekly");
      out.weekly_report_sections = serializeWeeklySections(
        parseWeeklySections(data.weekly_report_sections),
      );
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
    if (error && !/duplicate|unique/i.test(error.message)) throw serverFailure(error.message);
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

/** «Пригласить автора»: ссылка и сводка по приглашённым (без имён). Только владелец. */
export const inviteCardFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await adminLevel();
  return (await import("@/app/invites/invites.server")).inviteCard(ctx);
});
