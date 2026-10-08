import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: промокоды и подарочные сертификаты.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

const uuid = z.string().uuid();

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
        : serverFailure(error.message);
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
    if (error) throw serverFailure(error.message);
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
    if (error) throw serverFailure(error.message);
    return { ok: true };
  });
