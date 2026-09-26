import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";

/**
 * Раздел VIP платный: мало быть админом своего магазина — модуль должен быть
 * подключён, иначе тумблер в панели оператора прятал бы только пункт меню.
 */
const vip = async () => (await import("@/app/auth/guards.server")).requireAdminModule("vip");
/** Изменения — с роли менеджера (core/auth/roles). */
const vipWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminModule("vip", "manager");

async function groupOf(ctx: TenantContext) {
  if (!ctx.tenant.settings.vip?.token_enc)
    throw new UserError(
      "err.vip.connectBotFirst",
      "Сначала подключите VIP-бота — токен в разделе «VIP-бот».",
    );
  const { vipTelegramApi } = await import("@/channels/telegram/vip/handle");
  const { vipGroupApi } = await import("@/channels/telegram/vip/group");
  return vipGroupApi(vipTelegramApi(ctx));
}

export const vipStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await vip();
  const core = await import("@/core/vip/vip");
  const [settings, tariffs, subscriptions] = await Promise.all([
    core.vipSettings(ctx),
    core.listTariffs(ctx),
    core.listSubscriptions(ctx, { limit: 300 }),
  ]);
  const v = ctx.tenant.settings.vip;
  return {
    bot: {
      connected: Boolean(v?.token_enc),
      username: v?.username ?? null,
      webhookOk: v?.webhook_ok === true,
    },
    settings,
    tariffs,
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      telegram_id: s.telegram_id,
      username: s.username,
      first_name: s.first_name,
      last_name: s.last_name,
      status: s.status,
      started_at: s.started_at,
      expires_at: s.expires_at,
      created_at: s.created_at,
      imported: s.imported,
      admin_note: s.admin_note,
      has_proof: Boolean(s.payment_proof_path),
      has_invite: Boolean(s.group_invite_link),
      tariff: s.vip_tariffs
        ? {
            id: s.vip_tariffs.id,
            name: s.vip_tariffs.name,
            price: s.vip_tariffs.price,
            currency: s.vip_tariffs.currency,
          }
        : null,
    })),
  };
});

export const connectVipBotFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ token: z.string().regex(/^\d+:[\w-]{30,}$/, "Не похоже на токен BotFather") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await vipWrite();
    const { connectVipBot } = await import("@/app/operator/operator.server");
    return connectVipBot(ctx.tenant.id, data.token, "admin");
  });

const tariffInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  price: z.number().min(0),
  currency: z.string().trim().length(3),
  duration_days: z.number().int().min(1).max(3650),
  duration_minutes: z.number().int().min(1).max(100_000).nullable().optional(),
  is_active: z.boolean(),
  is_public: z.boolean(),
  is_entry: z.boolean(),
  sort_order: z.number().int(),
});

export const saveVipTariffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => tariffInput.parse(d))
  .handler(async ({ data }) => {
    const ctx = await vipWrite();
    const { saveTariff } = await import("@/core/vip/vip");
    return { id: await saveTariff(ctx, data) };
  });

export const deleteVipTariffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await vipWrite();
    const { deleteTariff } = await import("@/core/vip/vip");
    await deleteTariff(ctx, data.id);
    return { ok: true };
  });

export const vipSubscriptionActionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["confirm", "reject", "resend", "exclude", "delete", "extend"]),
        days: z.number().int().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await vipWrite();
    const core = await import("@/core/vip/vip");
    const group = await groupOf(ctx);
    const { adminLocale } = await import("@/app/admin/locale.server");
    const { adminT, intlLocale } = await import("@/app/i18n/admin");
    const locale = await adminLocale(ctx);
    const t = adminT(locale);
    switch (data.action) {
      case "confirm": {
        const r = await core.activateSubscription(ctx, group, data.id);
        return {
          ok: true,
          message: r.deliveryFailed ? t("msg.vip.confirmedUndelivered") : t("msg.vip.confirmed"),
        };
      }
      case "reject": {
        const r = await core.rejectSubscription(ctx, group, data.id, data.note);
        return {
          ok: true,
          message: r.alreadyProcessed ? t("msg.vip.alreadyProcessed") : t("msg.vip.rejected"),
        };
      }
      case "resend":
        await core.resendInvite(ctx, group, data.id);
        return { ok: true, message: t("msg.vip.linkResent") };
      case "exclude":
        await core.excludeMember(ctx, group, data.id);
        return { ok: true, message: t("msg.vip.excluded") };
      case "delete": {
        const r = await core.deleteSubscription(ctx, group, data.id);
        return {
          ok: true,
          message: r.forgotProfile ? t("msg.vip.deletedWithProfile") : t("msg.vip.deleted"),
        };
      }
      case "extend": {
        if (!data.days) throw new UserError("err.vip.daysRequired", "Укажите число дней");
        const r = await core.extendSubscription(ctx, group, data.id, data.days);
        return {
          ok: true,
          message: r.expired
            ? t("msg.vip.ended")
            : t("msg.vip.extended", {
                date: new Date(r.expiresAt).toLocaleString(intlLocale(locale), {
                  timeZone: ctx.timezone,
                }),
              }),
        };
      }
    }
  });

export const addVipManualFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: z.number().int().positive(),
        tariffId: z.string().uuid(),
        days: z.number().int().min(1).max(3650).optional(),
        status: z.enum(["active", "expired"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await vipWrite();
    const { addManualSubscription } = await import("@/core/vip/vip");
    const r = await addManualSubscription(ctx, await groupOf(ctx), data);
    if (!r.warningKeys.length) return { ok: r.ok, warning: r.warning };
    const t = await (await import("@/app/admin/locale.server")).adminTFor(ctx);
    const text = {
      notInGroup: "msg.vip.warn.notInGroup",
      noGroup: "msg.vip.warn.noGroup",
      undelivered: "msg.vip.warn.undelivered",
    } as const;
    return { ok: r.ok, warning: r.warningKeys.map((k) => t(text[k])).join(" ") };
  });

export const runVipCronFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await vipWrite();
  const { runVipCron } = await import("@/core/vip/cron");
  return runVipCron(ctx, await groupOf(ctx), ctx.tenant.settings.vip?.username ?? null);
});

export const vipProofUrlFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await vipWrite();
    const { getSubscription } = await import("@/core/vip/vip");
    const { proofSignedUrl } = await import("@/core/orders/admin");
    const sub = await getSubscription(ctx, data.id);
    if (!sub?.payment_proof_path) return { url: null };
    return { url: await proofSignedUrl(ctx, sub.payment_proof_path) };
  });
