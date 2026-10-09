import type { TenantContext } from "@/core/tenant/resolve.server";
import { serviceDb } from "@/core/db/client.server";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { addTariffDuration, formatDateTime, inviteExpireDate } from "./pure";
import { type MemberUser, type VipGroup, esc, isMember, vipSettings } from "./vip-model";
import { assignMemberTariff } from "./tariffs";
import { getSubscription } from "./subscription-queries";

/** Заявка, чек, подтверждение и отказ. */

/* ── подписки: заявка и чек ─────────────────────────────────────────── */

/**
 * Покупатель выбрал тариф: одна ожидающая заявка на человека. Существующая
 * переводится на новый тариф (прежний чек обнуляется), последняя
 * отклонённая переиспользуется — «Отклонённые» не копятся в админке.
 */
export async function startPending(
  ctx: TenantContext,
  telegramId: number,
  user: MemberUser,
  tariffId: string,
): Promise<{ id: string }> {
  const person = {
    tariff_id: tariffId,
    payment_proof_path: null,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
  };
  const { data: pendings, error: pendingsError } = await ctx.db
    .from("vip_subscriptions")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false });
  if (pendingsError) throw serverFailure(`VIP: ожидающие заявки: ${pendingsError.message}`);
  const existing = pendings?.[0];
  if (existing) {
    const upd = await ctx.db.from("vip_subscriptions").update(person).eq("id", existing.id);
    if (upd.error) throw serverFailure(`VIP: заявка не обновлена: ${upd.error.message}`);
    const older = (pendings ?? []).slice(1).map((p) => p.id);
    if (older.length) {
      const cancel = await ctx.db
        .from("vip_subscriptions")
        .update({ status: "cancelled" })
        .in("id", older);
      if (cancel.error) throw serverFailure(`VIP: старые заявки: ${cancel.error.message}`);
    }
    return { id: existing.id };
  }
  const { data: cancelled, error: cancelledError } = await ctx.db
    .from("vip_subscriptions")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (cancelledError) throw serverFailure(`VIP: отклонённые заявки: ${cancelledError.message}`);
  const reuse = cancelled?.[0];
  if (reuse) {
    const { error } = await ctx.db
      .from("vip_subscriptions")
      .update({
        ...person,
        status: "pending_payment",
        group_invite_link: null,
        admin_note: null,
        expires_at: new Date().toISOString(),
      })
      .eq("id", reuse.id)
      .eq("status", "cancelled");
    if (error) throw serverFailure(error.message);
    const extra = (cancelled ?? []).slice(1).map((r) => r.id);
    if (extra.length) {
      const del = await ctx.db.from("vip_subscriptions").delete().in("id", extra);
      if (del.error) throw serverFailure(`VIP: лишние заявки: ${del.error.message}`);
    }
    return { id: reuse.id };
  }
  const { data, error } = await ctx.db
    .from("vip_subscriptions")
    .insert({
      bot_id: ctx.tenant.id,
      telegram_id: telegramId,
      ...person,
      status: "pending_payment",
      expires_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return { id: data.id };
}

export async function attachProof(
  ctx: TenantContext,
  subscriptionId: string,
  file: { bytes: Uint8Array; mime: string; ext: string },
): Promise<string | null> {
  const key = `${ctx.tenant.id}/vip-${subscriptionId}/${Date.now()}.${file.ext}`;
  const up = await serviceDb()
    .storage.from("payment-proofs")
    .upload(key, new Blob([file.bytes as BlobPart], { type: file.mime }), {
      contentType: file.mime,
      upsert: true,
    });
  if (up.error) {
    console.error("[vip] proof upload failed", up.error.message);
    return null;
  }
  const saved = await ctx.db
    .from("vip_subscriptions")
    .update({ payment_proof_path: key })
    .eq("id", subscriptionId);
  if (saved.error) {
    console.error("[vip] proof path not saved", saved.error.message);
    return null;
  }
  return key;
}

/* ── подписки: активация, продление, отказ ──────────────────────────── */

export async function expireOtherActives(
  ctx: TenantContext,
  group: VipGroup,
  telegramId: number,
  keepId: string | undefined,
  groupId: string,
) {
  let q = ctx.db
    .from("vip_subscriptions")
    .select("id, group_invite_link")
    .eq("telegram_id", telegramId)
    .eq("status", "active");
  if (keepId) q = q.neq("id", keepId);
  const { data: others } = await q;
  for (const o of others ?? [])
    if (groupId && o.group_invite_link) await group.revokeInvite(groupId, o.group_invite_link);
  if ((others ?? []).length > 0) {
    let u = ctx.db
      .from("vip_subscriptions")
      .update({ status: "expired", group_invite_link: null })
      .eq("telegram_id", telegramId)
      .eq("status", "active");
    if (keepId) u = u.neq("id", keepId);
    await u;
  }
}

export async function latestActiveExpiry(
  ctx: TenantContext,
  telegramId: number,
  excludeId?: string,
): Promise<Date | null> {
  let q = ctx.db
    .from("vip_subscriptions")
    .select("expires_at")
    .eq("telegram_id", telegramId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q.order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw serverFailure(`VIP: срок другой подписки: ${error.message}`);
  return data?.expires_at ? new Date(data.expires_at) : null;
}

export type ActivateResult = {
  ok: true;
  deliveryFailed: boolean;
  expiresAt: string;
  /** Продление: участник уже в группе или прошлая подписка ещё идёт. */
  renewed: boolean;
};

/**
 * Подтверждённый платёж → доступ. Инвайт создаётся ДО перевода в active
 * (иначе «активна без ссылки»), другие активные закрываются ДО обновления
 * (частичный UNIQUE на одну активную), продление стыкуется к остатку
 * оплаченного срока, а не считается от «сейчас».
 */
export async function activateSubscription(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
): Promise<ActivateResult> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  if (sub.status === "active") throw new UserError("err.vip.alreadyActive", "Подписка уже активна");
  if (sub.status !== "pending_payment")
    throw new UserError(
      "err.vip.confirmOnlyPending",
      "Подтвердить можно только заявку «ожидает оплаты»",
    );
  const settings = await vipSettings(ctx);
  if (!settings.groupId)
    throw new UserError(
      "err.vip.groupIdMissingInSettings",
      "Не настроен ID VIP-группы в настройках",
    );

  const now = new Date();
  const latest = await latestActiveExpiry(ctx, sub.telegram_id, id);
  const stacked = Boolean(latest && latest.getTime() > now.getTime());
  const expiresAt = addTariffDuration(stacked ? latest! : now, sub.vip_tariffs, settings.testMode);

  const inGroup = await isMember(group, settings.groupId, sub.telegram_id);
  let link: string | null = null;
  if (!inGroup) {
    link = await group.createInvite(
      settings.groupId,
      `vip-${id.slice(0, 8)}`,
      inviteExpireDate(expiresAt),
    );
    if (!link)
      throw new UserError(
        "err.vip.inviteFailed",
        "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
      );
  }
  await expireOtherActives(ctx, group, sub.telegram_id, id, settings.groupId);
  const { data: updated, error } = await ctx.db
    .from("vip_subscriptions")
    .update({
      status: "active",
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      group_invite_link: link,
      admin_note: null,
    })
    .eq("id", id)
    .eq("status", "pending_payment")
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    if (link) await group.revokeInvite(settings.groupId, link);
    throw error
      ? new UserError("err.vip.updateFailed", "Ошибка обновления: {error}", {
          error: error.message,
        })
      : new UserError(
          "err.vip.processedByAnotherAdmin",
          "Заявку уже обработал другой администратор",
        );
  }

  const until = esc(formatDateTime(expiresAt, ctx.timezone));
  const welcome = esc(settings.welcome);
  const text = inGroup
    ? `✅ ${welcome}\n\nДоступ продлён до: <b>${until}</b>\n\nВы остаётесь в VIP-группе — новая ссылка не нужна.`
    : stacked
      ? `✅ ${welcome}\n\nДоступ продлён до: <b>${until}</b>\n\nВас нет в группе — одноразовая ссылка для возврата:\n${link}`
      : `✅ ${welcome}\n\nСрок действия до: <b>${until}</b>\n\nВаша персональная одноразовая ссылка для вступления:\n${link}`;
  const sent = await group.send(sub.telegram_id, text);

  const t = sub.vip_tariffs;
  if (t && t.is_public === false && !t.is_entry)
    await assignMemberTariff(ctx, sub.telegram_id, sub, t.id, "payment");
  return {
    ok: true,
    deliveryFailed: !sent,
    expiresAt: expiresAt.toISOString(),
    renewed: inGroup || stacked,
  };
}

export async function rejectSubscription(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
  note?: string,
): Promise<{ ok: true; alreadyProcessed?: boolean }> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  if (sub.status !== "pending_payment") return { ok: true, alreadyProcessed: true };
  const { groupId } = await vipSettings(ctx);
  if (groupId && sub.group_invite_link) await group.revokeInvite(groupId, sub.group_invite_link);
  const { data: updated, error } = await ctx.db
    .from("vip_subscriptions")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending_payment")
    .select("telegram_id")
    .maybeSingle();
  if (error) throw serverFailure(error.message);
  if (!updated) return { ok: true, alreadyProcessed: true };
  // Одна «отклонённая» на человека.
  const cleanup = await ctx.db
    .from("vip_subscriptions")
    .delete()
    .eq("telegram_id", updated.telegram_id)
    .eq("status", "cancelled")
    .neq("id", id);
  if (cleanup.error) console.error("[vip] old rejected not removed", cleanup.error.message);
  await group.send(
    updated.telegram_id,
    `❌ Ваша оплата была отклонена.${note ? `\n\nПричина: ${esc(note)}` : ""} Если это ошибка, свяжитесь с поддержкой.`,
  );
  return { ok: true };
}
