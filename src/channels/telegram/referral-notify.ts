import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ReferralGrant } from "@/core/referrals/referrals";
import { stateFromJson } from "@/core/customers/customers";
import { isLocale } from "@/core/i18n/locale";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";
import { adminTelegramApi } from "./notify";

/**
 * Награда пригласившему после выдачи заказа — одно сообщение в Telegram на
 * языке пригласившего, из любого пути выдачи (бот, админка, Direct, сайт).
 * Награда уже записана в базе: сбой отправки только в журнал, второй раз и
 * другим способом не шлём — сообщение могло дойти.
 */
export async function notifyReferralReward(
  ctx: TenantContext,
  grant: ReferralGrant | null | undefined,
  api: TelegramApi | null = adminTelegramApi(ctx),
): Promise<void> {
  if (!grant || !api) return;
  const { data: u, error } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("telegram_id", grant.telegramId)
    .maybeSingle();
  if (error)
    console.error(`[referral] язык покупателя не прочитан, награда без перевода: ${error.message}`);
  const st = stateFromJson(u?.state);
  const locale = isLocale(st.locale) ? st.locale : (ctx.tenant.settings.default_locale ?? "ru");
  try {
    await api.call("sendMessage", {
      chat_id: grant.telegramId,
      text: COPY[locale].referralReward(grant.percent, grant.code),
      parse_mode: "HTML",
    });
  } catch (e) {
    console.error(`[referral] сообщение о награде не ушло: ${String(e)}`);
  }
}
