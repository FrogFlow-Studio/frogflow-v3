import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { getSettings } from "@/core/settings/settings";
import { serviceDb } from "@/core/db/client.server";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { UserError } from "@/core/i18n/user-error";
import {
  addTariffDuration,
  formatDateTime,
  inviteExpireDate,
  isAlreadyNotInChat,
  memberStatusIsInGroup,
  resolveVipExtension,
  resolveWarnWindows,
  TEST_MODE_DEFAULT_MINUTES,
} from "./pure";

/**
 * VIP-подписки: платный доступ в закрытую Telegram-группу по тарифам.
 * Ядро не знает Telegram — группа приходит интерфейсом VipGroup, который
 * канал реализует токеном VIP-бота клиента. Все денежные переходы здесь:
 * заявка → чек → подтверждение → инвайт → продление → истечение.
 */
export type TariffRow = Database["public"]["Tables"]["vip_tariffs"]["Row"];
export type SubscriptionRow = Database["public"]["Tables"]["vip_subscriptions"]["Row"];
export type SubscriptionWithTariff = SubscriptionRow & { vip_tariffs: TariffRow | null };
export type MemberProfileRow = Database["public"]["Tables"]["vip_member_profiles"]["Row"];

export type MemberUser = {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export type GroupMember = { status: string; user?: MemberUser & { id: number } };

/** Группа глазами ядра: канал подставляет Telegram API VIP-бота. */
export type VipGroup = {
  member(groupId: string, telegramId: number): Promise<GroupMember | null>;
  createInvite(groupId: string, name: string, expireDate: number): Promise<string | null>;
  revokeInvite(groupId: string, link: string): Promise<void>;
  /** ban + unban: выгнать, не запрещая вернуться по новой ссылке. */
  kick(groupId: string, telegramId: number): Promise<{ ok: boolean; description?: string }>;
  send(telegramId: number, html: string): Promise<boolean>;
};

export const VIP_SETTING_KEYS = [
  "vip_group_id",
  "vip_payment_instructions",
  "vip_payment_qr_path",
  "vip_test_mode",
  "vip_warn_days",
  "vip_warn_days_2",
  "vip_welcome_message",
] as const;

export type VipSettings = {
  groupId: string;
  instructions: string;
  qrPath: string;
  testMode: boolean;
  warnDays: number;
  warnDays2: number;
  welcome: string;
};

export async function vipSettings(ctx: TenantContext): Promise<VipSettings> {
  const s = await getSettings(ctx, VIP_SETTING_KEYS);
  const w = resolveWarnWindows(s.vip_warn_days ?? "", s.vip_warn_days_2 ?? "");
  return {
    groupId: (s.vip_group_id ?? "").trim(),
    instructions: s.vip_payment_instructions ?? "",
    qrPath: s.vip_payment_qr_path ?? "",
    testMode: s.vip_test_mode === "true",
    warnDays: w.warnDays,
    warnDays2: w.warnDays2,
    welcome: s.vip_welcome_message || "Ваша VIP подписка активна!",
  };
}

async function isMember(group: VipGroup, groupId: string, telegramId: number): Promise<boolean> {
  const m = await group.member(groupId, telegramId);
  return memberStatusIsInGroup(m?.status);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ── тарифы ─────────────────────────────────────────────────────────── */

export async function listTariffs(ctx: TenantContext): Promise<TariffRow[]> {
  const { data, error } = await ctx.db.from("vip_tariffs").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Публичные активные тарифы продления — без пакета «первый вход». */
export async function renewTariffs(ctx: TenantContext): Promise<TariffRow[]> {
  return (await listTariffs(ctx)).filter((t) => t.is_active && t.is_public && !t.is_entry);
}

export async function entryTariff(ctx: TenantContext): Promise<TariffRow | null> {
  const { data } = await ctx.db
    .from("vip_tariffs")
    .select("*")
    .eq("is_entry", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getTariff(ctx: TenantContext, id: string): Promise<TariffRow | null> {
  const { data } = await ctx.db.from("vip_tariffs").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export type TariffInput = {
  id?: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_days: number;
  duration_minutes?: number | null;
  is_active: boolean;
  is_public: boolean;
  is_entry: boolean;
  sort_order: number;
};

/** Пакет «первый вход» — один на клиента: флаг снимается с остальных. */
export async function saveTariff(ctx: TenantContext, input: TariffInput): Promise<string> {
  if (input.is_entry) {
    let q = ctx.db.from("vip_tariffs").update({ is_entry: false }).eq("is_entry", true);
    if (input.id) q = q.neq("id", input.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
  const payload = {
    name: input.name,
    description: input.description ?? "",
    price: input.price,
    currency: input.currency,
    duration_days: input.duration_days,
    duration_minutes: input.duration_minutes ?? null,
    is_active: input.is_active,
    is_public: input.is_entry ? false : input.is_public,
    is_entry: input.is_entry,
    sort_order: input.is_entry ? -100 : input.sort_order,
  };
  if (input.id) {
    const { error } = await ctx.db.from("vip_tariffs").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return input.id;
  }
  const { data, error } = await ctx.db
    .from("vip_tariffs")
    .insert({ ...payload, bot_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return data.id;
}

export async function deleteTariff(ctx: TenantContext, id: string): Promise<void> {
  const { count } = await ctx.db
    .from("vip_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("tariff_id", id);
  if ((count ?? 0) > 0)
    throw new UserError(
      "err.vip.tariffHasSubscriptions",
      "По тарифу есть подписки — выключите его, а не удаляйте.",
    );
  const { error } = await ctx.db.from("vip_tariffs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── профиль участника ──────────────────────────────────────────────── */

export async function assignMemberTariff(
  ctx: TenantContext,
  telegramId: number,
  user: MemberUser,
  tariffId: string,
  source: "deep_link" | "payment" | "admin",
): Promise<void> {
  const { error } = await ctx.db.from("vip_member_profiles").upsert(
    {
      bot_id: ctx.tenant.id,
      telegram_id: telegramId,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      assigned_tariff_id: tariffId,
      assigned_at: new Date().toISOString(),
      assigned_source: source,
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) console.error("[vip] assign tariff failed", error.message);
}

/** Персональный (скрытый) тариф участника, если он ещё активен. */
export async function memberAssignedTariff(
  ctx: TenantContext,
  telegramId: number,
): Promise<TariffRow | null> {
  const { data } = await ctx.db
    .from("vip_member_profiles")
    .select("assigned_tariff_id, vip_tariffs(*)")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  const t = (data?.vip_tariffs as TariffRow | null) ?? null;
  return data?.assigned_tariff_id && t?.is_active ? t : null;
}

/** Язык покупателя VIP-бота — выбран явно, не по языку устройства; null — первый контакт. */
export async function memberLocale(ctx: TenantContext, telegramId: number): Promise<Locale | null> {
  const { data } = await ctx.db
    .from("vip_member_profiles")
    .select("locale")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return isLocale(data?.locale) ? data!.locale : null;
}

export async function setMemberLocale(
  ctx: TenantContext,
  telegramId: number,
  user: MemberUser,
  locale: Locale,
): Promise<void> {
  const { error } = await ctx.db.from("vip_member_profiles").upsert(
    {
      bot_id: ctx.tenant.id,
      telegram_id: telegramId,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      locale,
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) console.error("[vip] set locale failed", error.message);
}

/* ── подписки: чтение ───────────────────────────────────────────────── */

const WITH_TARIFF = "*, vip_tariffs(*)";

export async function activeSubscription(
  ctx: TenantContext,
  telegramId: number,
  now = new Date(),
): Promise<SubscriptionWithTariff | null> {
  const { data } = await ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .eq("telegram_id", telegramId)
    .eq("status", "active")
    .gt("expires_at", now.toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SubscriptionWithTariff | null) ?? null;
}

export async function pendingSubscription(
  ctx: TenantContext,
  telegramId: number,
): Promise<SubscriptionWithTariff | null> {
  const { data, error } = await ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .eq("telegram_id", telegramId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SubscriptionWithTariff | null) ?? null;
}

/** Был ли когда-нибудь оплаченный доступ (active/expired) — тогда «первый вход» недоступен. */
export async function hadPaidAccess(ctx: TenantContext, telegramId: number): Promise<boolean> {
  const { count } = await ctx.db
    .from("vip_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId)
    .in("status", ["active", "expired"]);
  return (count ?? 0) > 0;
}

export async function getSubscription(
  ctx: TenantContext,
  id: string,
): Promise<SubscriptionWithTariff | null> {
  const { data } = await ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .eq("id", id)
    .maybeSingle();
  return (data as SubscriptionWithTariff | null) ?? null;
}

export async function listSubscriptions(
  ctx: TenantContext,
  filter: { status?: string; q?: string; limit?: number } = {},
): Promise<SubscriptionWithTariff[]> {
  let q = ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 300);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.q?.trim()) {
    const t = filter.q.trim().replace(/[%,()]/g, "");
    q = /^\d+$/.test(t)
      ? q.eq("telegram_id", Number(t))
      : q.or(`username.ilike.%${t}%,first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SubscriptionWithTariff[];
}

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
  const { data: pendings } = await ctx.db
    .from("vip_subscriptions")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false });
  const existing = pendings?.[0];
  if (existing) {
    await ctx.db.from("vip_subscriptions").update(person).eq("id", existing.id);
    const older = (pendings ?? []).slice(1).map((p) => p.id);
    if (older.length)
      await ctx.db.from("vip_subscriptions").update({ status: "cancelled" }).in("id", older);
    return { id: existing.id };
  }
  const { data: cancelled } = await ctx.db
    .from("vip_subscriptions")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("status", "cancelled")
    .order("created_at", { ascending: false });
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
    if (error) throw new Error(error.message);
    const extra = (cancelled ?? []).slice(1).map((r) => r.id);
    if (extra.length) await ctx.db.from("vip_subscriptions").delete().in("id", extra);
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
  await ctx.db
    .from("vip_subscriptions")
    .update({ payment_proof_path: key })
    .eq("id", subscriptionId);
  return key;
}

/* ── подписки: активация, продление, отказ ──────────────────────────── */

async function expireOtherActives(
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

async function latestActiveExpiry(
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
  const { data } = await q.order("expires_at", { ascending: false }).limit(1).maybeSingle();
  return data?.expires_at ? new Date(data.expires_at) : null;
}

export type ActivateResult = { ok: true; deliveryFailed: boolean; expiresAt: string };

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
  return { ok: true, deliveryFailed: !sent, expiresAt: expiresAt.toISOString() };
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
  if (error) throw new Error(error.message);
  if (!updated) return { ok: true, alreadyProcessed: true };
  // Одна «отклонённая» на человека.
  await ctx.db
    .from("vip_subscriptions")
    .delete()
    .eq("telegram_id", updated.telegram_id)
    .eq("status", "cancelled")
    .neq("id", id);
  await group.send(
    updated.telegram_id,
    `❌ Ваша оплата была отклонена.${note ? `\n\nПричина: ${esc(note)}` : ""} Если это ошибка, свяжитесь с поддержкой.`,
  );
  return { ok: true };
}

/** Инвайт и уведомление после ручной активации из админки. */
async function grantAccess(
  ctx: TenantContext,
  group: VipGroup,
  p: { id: string; telegramId: number; expiresAt: Date; groupId: string; welcome: string },
): Promise<{ inGroup: boolean; inviteSent: boolean; deliveryFailed: boolean }> {
  const inGroup = await isMember(group, p.groupId, p.telegramId);
  let link: string | null = null;
  if (!inGroup) {
    link = await group.createInvite(
      p.groupId,
      `vip-man-${p.id.slice(0, 8)}`,
      inviteExpireDate(p.expiresAt),
    );
    if (!link)
      throw new UserError(
        "err.vip.inviteFailed",
        "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
      );
  }
  const { error } = await ctx.db
    .from("vip_subscriptions")
    .update({ group_invite_link: link })
    .eq("id", p.id);
  if (error) {
    if (link) await group.revokeInvite(p.groupId, link);
    throw new UserError("err.vip.linkSaveFailed", "Ошибка сохранения ссылки: {error}", {
      error: error.message,
    });
  }
  const until = esc(formatDateTime(p.expiresAt, ctx.timezone));
  const sent = await group.send(
    p.telegramId,
    inGroup
      ? `✅ ${esc(p.welcome)}\n\nПодписка оформлена администратором до: <b>${until}</b>\n\nВы уже в VIP-группе — новая ссылка не нужна.`
      : `✅ ${esc(p.welcome)}\n\nПодписка оформлена администратором до: <b>${until}</b>\n\nВаша персональная одноразовая ссылка для вступления:\n${link}`,
  );
  return { inGroup, inviteSent: Boolean(link), deliveryFailed: !sent };
}

/**
 * Предупреждения ручного добавления — кодами: ядро не знает языка админки,
 * текст на языке продавца собирает серверный слой панели.
 */
export type ManualWarning = "notInGroup" | "noGroup" | "undelivered";

export async function addManualSubscription(
  ctx: TenantContext,
  group: VipGroup,
  p: { telegramId: number; tariffId: string; days?: number; status: "active" | "expired" },
): Promise<{ ok: true; warning?: string; warningKeys: ManualWarning[] }> {
  const settings = await vipSettings(ctx);
  const tariff = await getTariff(ctx, p.tariffId);
  if (!tariff) throw new UserError("err.vip.tariffNotFound", "Тариф не найден");
  const now = new Date();
  const expiresAt = new Date(now);
  if (settings.testMode)
    expiresAt.setMinutes(
      expiresAt.getMinutes() + (tariff.duration_minutes || TEST_MODE_DEFAULT_MINUTES),
    );
  else expiresAt.setDate(expiresAt.getDate() + (p.days ?? tariff.duration_days ?? 30));

  let user: MemberUser = {};
  let warning: string | undefined;
  const warningKeys: ManualWarning[] = [];
  if (settings.groupId) {
    const m = await group.member(settings.groupId, p.telegramId);
    if (m?.user) user = m.user;
    else {
      warning =
        "Пользователь не найден в VIP-группе. Подписка создана; ссылка уйдёт, если он писал боту.";
      warningKeys.push("notInGroup");
    }
  }
  if (p.status === "active")
    await expireOtherActives(ctx, group, p.telegramId, undefined, settings.groupId);
  const { data: inserted, error } = await ctx.db
    .from("vip_subscriptions")
    .insert({
      bot_id: ctx.tenant.id,
      telegram_id: p.telegramId,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      tariff_id: p.tariffId,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: p.status,
      imported: true,
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "insert failed");
  if (p.status === "active") {
    if (!settings.groupId) {
      warning = `${warning ? `${warning} ` : ""}VIP-группа не настроена — инвайт не отправлен.`;
      warningKeys.push("noGroup");
    } else {
      const r = await grantAccess(ctx, group, {
        id: inserted.id,
        telegramId: p.telegramId,
        expiresAt,
        groupId: settings.groupId,
        welcome: settings.welcome,
      });
      if (r.deliveryFailed) {
        warning = `${warning ? `${warning} ` : ""}Сообщение пользователю не доставлено (не писал боту или заблокировал). Ссылка сохранена — используйте «Переотправить».`;
        warningKeys.push("undelivered");
      }
    }
  }
  if (tariff.is_public === false && !tariff.is_entry)
    await assignMemberTariff(ctx, p.telegramId, user, tariff.id, "admin");
  return { ok: true, warning, warningKeys };
}

export async function extendSubscription(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
  days: number,
): Promise<{ ok: true; expired: boolean; expiresAt: string }> {
  if (!Number.isInteger(days) || days === 0)
    throw new UserError("err.vip.daysNonZero", "Укажите число дней, отличное от нуля");
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  const { groupId } = await vipSettings(ctx);
  const { wasInactive, baseSafe, shortenedPast } = resolveVipExtension(sub, days);
  if (days < 0 && wasInactive)
    throw new UserError(
      "err.vip.cannotShortenExpired",
      "Нельзя уменьшить истёкшую подписку. Сначала продлите или создайте новую.",
    );
  let link = sub.group_invite_link;

  if (shortenedPast) {
    if (link && groupId) await group.revokeInvite(groupId, link);
    const { error } = await ctx.db
      .from("vip_subscriptions")
      .update({
        expires_at: baseSafe.toISOString(),
        status: "expired",
        admin_note: "admin_shortened",
        group_invite_link: null,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    const other = await latestActiveExpiry(ctx, sub.telegram_id, id);
    if (!other && groupId) await group.kick(groupId, sub.telegram_id);
    await group.send(
      sub.telegram_id,
      `ℹ️ Срок VIP изменён администратором.\n\nПодписка завершена <b>${esc(formatDateTime(baseSafe, ctx.timezone))}</b>.${other ? "" : "\nДоступ к группе закрыт."}`,
    );
    return { ok: true, expired: true, expiresAt: baseSafe.toISOString() };
  }

  const until = esc(formatDateTime(baseSafe, ctx.timezone));
  let notify: string;
  if (wasInactive && groupId) {
    if (await isMember(group, groupId, sub.telegram_id)) {
      if (link) await group.revokeInvite(groupId, link);
      link = null;
      notify = `✅ Подписка продлена до <b>${until}</b>\n\nВы уже в VIP-группе — новая ссылка не нужна.`;
    } else {
      if (link) await group.revokeInvite(groupId, link);
      link = await group.createInvite(
        groupId,
        `vip-ext-${id.slice(0, 8)}`,
        inviteExpireDate(baseSafe),
      );
      if (!link)
        throw new UserError(
          "err.vip.inviteFailed",
          "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
        );
      notify = `✅ Подписка продлена до <b>${until}</b>\n\nОдноразовая ссылка для вступления:\n${link}`;
    }
  } else {
    notify = `✅ Ваша VIP подписка ${days > 0 ? "продлена" : "изменена"} до <b>${until}</b>.`;
  }
  if (wasInactive) await expireOtherActives(ctx, group, sub.telegram_id, id, groupId);
  const { error } = await ctx.db
    .from("vip_subscriptions")
    .update({
      expires_at: baseSafe.toISOString(),
      status: "active",
      admin_note: null,
      group_invite_link: link,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await group.send(sub.telegram_id, notify);
  return { ok: true, expired: false, expiresAt: baseSafe.toISOString() };
}

/** Новая ссылка для активной подписки, чей инвайт до покупателя не дошёл. */
export async function resendInvite(ctx: TenantContext, group: VipGroup, id: string): Promise<void> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  if (sub.status !== "active")
    throw new UserError(
      "err.vip.resendOnlyActive",
      "Переотправить ссылку можно только для активной подписки",
    );
  const { groupId } = await vipSettings(ctx);
  if (!groupId) throw new UserError("err.vip.groupIdMissing", "Не настроен ID VIP-группы");
  if (await isMember(group, groupId, sub.telegram_id))
    throw new UserError(
      "err.vip.alreadyInGroup",
      "Пользователь уже состоит в VIP-группе — ссылка не нужна",
    );
  if (sub.group_invite_link) await group.revokeInvite(groupId, sub.group_invite_link);
  const expiresAt = new Date(sub.expires_at);
  const link = await group.createInvite(
    groupId,
    `vip-resend-${id.slice(0, 8)}`,
    inviteExpireDate(expiresAt),
  );
  if (!link)
    throw new UserError(
      "err.vip.inviteFailed",
      "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
    );
  const { error } = await ctx.db
    .from("vip_subscriptions")
    .update({ group_invite_link: link })
    .eq("id", id);
  if (error) {
    await group.revokeInvite(groupId, link);
    throw new UserError("err.vip.linkSaveFailed", "Ошибка сохранения ссылки: {error}", {
      error: error.message,
    });
  }
  const sent = await group.send(
    sub.telegram_id,
    `🔁 Ссылка для вступления в VIP-группу переотправлена администратором.\n\nСрок действия подписки до: <b>${esc(formatDateTime(expiresAt, ctx.timezone))}</b>\n\nОдноразовая ссылка:\n${link}`,
  );
  if (!sent)
    throw new UserError(
      "err.vip.resendUndelivered",
      "Ссылка создана и сохранена, но сообщение не доставлено — возможно, пользователь заблокировал бота.",
    );
}

/** Исключить из группы и закрыть доступ; история остаётся (expired). */
export async function excludeMember(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
): Promise<void> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  const { groupId } = await vipSettings(ctx);
  if (!groupId) throw new UserError("err.vip.groupIdMissing", "Не настроен ID VIP-группы");
  const { data: rows } = await ctx.db
    .from("vip_subscriptions")
    .select("id, group_invite_link")
    .eq("telegram_id", sub.telegram_id)
    .in("status", ["active", "pending_payment"]);
  for (const r of rows ?? [])
    if (r.group_invite_link) await group.revokeInvite(groupId, r.group_invite_link);
  const ban = await group.kick(groupId, sub.telegram_id);
  if (!ban.ok && !isAlreadyNotInChat(ban.description))
    throw ban.description
      ? new Error(ban.description)
      : new UserError(
          "err.vip.kickFailed",
          "Не удалось исключить из группы (бот админ? право ban users?)",
        );
  await ctx.db
    .from("vip_subscriptions")
    .update({ status: "expired", group_invite_link: null, admin_note: "admin_excluded" })
    .eq("telegram_id", sub.telegram_id)
    .eq("status", "active");
  await ctx.db
    .from("vip_subscriptions")
    .update({ status: "cancelled", group_invite_link: null })
    .eq("telegram_id", sub.telegram_id)
    .eq("status", "pending_payment");
  await group.send(
    sub.telegram_id,
    "❌ <b>Доступ к VIP-сообществу отозван администратором.</b>\n\nВы исключены из группы. Чтобы вернуться — оформите подписку заново в боте.",
  );
}

export async function deleteSubscription(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
): Promise<{ forgotProfile: boolean }> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  const { groupId } = await vipSettings(ctx);
  if (groupId && sub.group_invite_link) await group.revokeInvite(groupId, sub.group_invite_link);
  if (groupId && sub.status === "active") {
    const other = await latestActiveExpiry(ctx, sub.telegram_id, id);
    if (!other) await group.kick(groupId, sub.telegram_id);
  }
  const { error } = await ctx.db.from("vip_subscriptions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  const { count } = await ctx.db
    .from("vip_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", sub.telegram_id);
  const forgotProfile = (count ?? 0) === 0;
  if (forgotProfile)
    await ctx.db.from("vip_member_profiles").delete().eq("telegram_id", sub.telegram_id);
  return { forgotProfile };
}
