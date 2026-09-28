import type { Tenant } from "@/core/tenant/types";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { customerFromRow, updateStateSection } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { pricelistMode, isOffHours, pricelistHours } from "@/core/consultant/pricelist/mode";
import { loadPricelist } from "@/core/consultant/pricelist/catalog.server";
import { refreshRate } from "@/core/consultant/pricelist/rate.server";
import {
  FOLLOW_UP_SETTING_KEY,
  FOLLOW_UP_UNTIL_MS,
  followUpText,
  isFollowUpCandidate,
  recentWithFollowUp,
  type FollowUpState,
} from "@/core/consultant/pricelist/follow-up";
import { liveTransport, type ZernioTransport } from "./api.server";
import type { ZernioPlatform } from "./platform";

/**
 * Фоновые задачи консультанта по прайсу (крон health, раз в 15 минут, как
 * кроны v1): свежий курс рубля (шаг 18) и одно напоминание замолчавшему
 * покупателю в директе (шаг 16). Только клиенты v2 с режимом «по прайсу» —
 * список уже отобран маршрутом крона.
 */
const MAX_FOLLOW_UPS_PER_RUN = 20;

export async function runPricelistJobs(
  tenants: Tenant[],
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    if (!pricelistMode(t)) continue;
    const ctx = tenantContext(t);
    try {
      const rate = await refreshRate(ctx);
      const followUps = await sendPricelistFollowUps(ctx, now, transport);
      out[t.id] = {
        rate: rate.fetched ? rate.stored?.rate : (rate.error ?? "kept"),
        followUps,
      };
    } catch (e) {
      out[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

export async function sendPricelistFollowUps(
  ctx: TenantContext,
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<{ checked: number; sent: number; skipped?: string }> {
  if ((await getSetting(ctx, FOLLOW_UP_SETTING_KEY))?.trim() !== "on")
    return { checked: 0, sent: 0, skipped: "off" };
  if (isOffHours(now, pricelistHours(ctx.tenant), ctx.timezone))
    return { checked: 0, sent: 0, skipped: "off_hours" };
  const since = new Date(now.getTime() - FOLLOW_UP_UNTIL_MS - 3600_000).toISOString();
  const { data } = await ctx.db
    .from("bot_users")
    .select("*")
    .gte("updated_at", since)
    .not("zernio_conversation_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(300);
  const rows = data ?? [];
  const memoryOf = (state: unknown): FollowUpState => {
    const c = (state as { consultant?: unknown } | null)?.consultant;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as FollowUpState) : {};
  };
  const candidates = rows
    .map(customerFromRow)
    .filter((c) => c.zernioConversationId && c.zernioAccountId)
    .filter((c) => isFollowUpCandidate(memoryOf(c.state), now, false))
    .slice(0, MAX_FOLLOW_UPS_PER_RUN);
  if (!candidates.length) return { checked: rows.length, sent: 0 };

  const { products } = await loadPricelist(ctx);
  let sent = 0;
  for (const customer of candidates) {
    const memory = memoryOf(customer.state);
    const text = followUpText(memory, products);
    // Сначала отметка и «свой голос», потом отправка: второй крон не повторит,
    // а проверка «в чате менеджер» узнает своё сообщение (relayed).
    const marked = await updateStateSection(ctx, customer, "consultant", (cur) => ({
      ...cur,
      followup_for: memory.last_reply_at,
      ...(text
        ? {
            relayed: [...((cur.relayed as string[] | undefined) ?? []), text].slice(-10),
          }
        : {}),
    }));
    // Писать нечего (товара нет в прайсе) — только отметка: диалог больше не смотрим.
    if (!text) continue;
    const r = await transport.send(
      customer.zernioConversationId!,
      customer.zernioAccountId!,
      text,
      {
        platform: customer.platform as ZernioPlatform,
        idempotencyScope: `followup:${customer.userKey}:${memory.last_reply_at}`,
      },
    );
    if (!r.ok) {
      console.warn(`[followup:${ctx.tenant.id}] ${customer.userKey}: ${r.error}`);
      continue;
    }
    await updateStateSection(ctx, marked, "consultant", (cur) => ({
      ...cur,
      recent: recentWithFollowUp(cur as FollowUpState, text),
    }));
    if (ctx.tenant.modules.manager_chat) {
      const { recordMessage } = await import("@/core/chat/chat");
      await recordMessage(ctx, {
        telegramId: customer.telegramId,
        direction: "out",
        sender: "bot",
        text,
      }).catch(() => {});
    }
    sent++;
  }
  return { checked: rows.length, sent };
}
