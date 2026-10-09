import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { getSettings } from "@/core/settings/settings";
import { memberStatusIsInGroup, resolveWarnWindows } from "./pure";

/** Строки, настройки и группа VIP. */
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
  "vip_auto_confirm",
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
  /** Автопроверка чека подписки (core/vip/auto-check): по умолчанию выключена, как в v1. */
  autoConfirm: boolean;
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
    autoConfirm: s.vip_auto_confirm === "true",
    warnDays: w.warnDays,
    warnDays2: w.warnDays2,
    welcome: s.vip_welcome_message || "Ваша VIP подписка активна!",
  };
}

export async function isMember(
  group: VipGroup,
  groupId: string,
  telegramId: number,
): Promise<boolean> {
  const m = await group.member(groupId, telegramId);
  return memberStatusIsInGroup(m?.status);
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
