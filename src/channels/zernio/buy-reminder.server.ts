import type { Tenant } from "@/core/tenant/types";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { claimStateSection, customerFromRow, updateStateSection } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import { loadDirectBotSettings } from "@/core/instagram/direct-bot-settings";
import { buyerLocale } from "@/core/consultant/messages";
import { loadTasks } from "@/core/consultant/tasks";
import { pricelistMode, isOffHours } from "@/core/consultant/pricelist/mode";
import {
  buyerWindow,
  FOLLOW_UP_AFTER_MS,
  FOLLOW_UP_UNTIL_MS,
  recentWithFollowUp,
  type FollowUpState,
} from "@/core/consultant/pricelist/follow-up";
import { serverFailure } from "@/lib/server-failure";
import { liveTransport, type ZernioTransport } from "./api.server";
import { lastIncomingAt, managerInChat, readTail } from "./consultant-jobs.server";
import { buyOfferButton } from "./shop/buy-offer.server";
import { BUY_REMINDER_TEXT } from "./shop/buy-button";
import type { ZernioPlatform } from "./platform";

/**
 * Напоминание с кнопкой «Купить» (настройка канала buy_reminder, выключена по
 * умолчанию). Консультант ответил о товаре с кнопкой «Купить», покупатель не
 * нажал и молчит: через 3 часа бот один раз присылает кнопку ещё раз
 * (Копилка 21–25.10: 18 из 25 молчали после ответа с ценой).
 *
 * Как у напоминания консультанта по прайсу (consultant-jobs): с ответа бота
 * 3–23 часа, последнее сообщение покупателя не старше 23 часов (окно 24 часа
 * Instagram и WhatsApp), не на паузе, не после менеджера, не при открытой
 * задаче. Сверх того: только днём (9–21 по поясу магазина), не после заказа
 * покупателя и пока товар в продаже. Отметка followup_for на ответ бота —
 * условной записью до отправки: два крона одновременно напомнят один раз.
 * Отправку, которая могла дойти, не повторяем.
 */
const MAX_PER_RUN = 20;
const DAYTIME = { open: 9, close: 21 };

type BuyReminderState = FollowUpState & {
  buy_offer?: { productId?: unknown; variantId?: unknown; at?: unknown };
};

type Run = {
  checked: number;
  sent: number;
  skipped?: string;
  manager?: number;
  window?: number;
  task?: number;
  ordered?: number;
  gone?: number;
};

export async function runBuyReminders(
  tenants: Tenant[],
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    // Консультант по прайсу напоминает сам (sendPricelistFollowUps).
    if (pricelistMode(t)) continue;
    if (!t.modules.wa_shop && !t.modules.dm_shop) continue;
    try {
      out[t.id] = await sendBuyReminders(tenantContext(t), now, transport);
    } catch (e) {
      out[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

const memoryOf = (state: unknown): BuyReminderState => {
  const c = (state as { consultant?: unknown } | null)?.consultant;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as BuyReminderState) : {};
};

/** Кандидат по состоянию: есть кнопка, тишина 3–23 ч, на этот ответ ещё не напоминали. */
export function isBuyReminderCandidate(state: BuyReminderState, now: Date): boolean {
  if (state.paused_until && Date.parse(state.paused_until) > now.getTime()) return false;
  if (typeof state.buy_offer?.productId !== "string") return false;
  // Кнопка была в последнем ответе бота, а не в одном из прежних.
  if (!state.last_reply_at || state.buy_offer.at !== state.last_reply_at) return false;
  const at = Date.parse(state.last_reply_at ?? "");
  if (!Number.isFinite(at)) return false;
  const silence = now.getTime() - at;
  if (silence < FOLLOW_UP_AFTER_MS || silence > FOLLOW_UP_UNTIL_MS) return false;
  return (state.followup_for ?? state.v2_followup_for) !== state.last_reply_at;
}

export async function sendBuyReminders(
  ctx: TenantContext,
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<Run> {
  const platforms: ZernioPlatform[] = [];
  for (const p of ["whatsapp", "instagram"] as const) {
    const on = p === "whatsapp" ? ctx.tenant.modules.wa_shop : ctx.tenant.modules.dm_shop;
    if (!on) continue;
    const s = await loadDirectBotSettings(ctx, p);
    const f = s.features;
    if (f.buy_reminder && f.buy_button && f.cart && f.checkout) platforms.push(p);
  }
  if (!platforms.length) return { checked: 0, sent: 0, skipped: "off" };
  // Продавец выключил консультанта — бот в переписке от его имени не пишет.
  if ((await getSetting(ctx, "consultant_enabled"))?.trim() === "false")
    return { checked: 0, sent: 0, skipped: "consultant_off" };
  if (isOffHours(now, DAYTIME, ctx.timezone)) return { checked: 0, sent: 0, skipped: "night" };

  const since = new Date(now.getTime() - FOLLOW_UP_UNTIL_MS - 3600_000).toISOString();
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("*")
        .gte("updated_at", since)
        .not("zernio_conversation_id", "is", null)
        .order("updated_at", { ascending: false })
        .order("user_key")
        .range(from, to),
    "[buy-reminder] диалоги не прочитаны",
  );
  const candidates = rows
    .map(customerFromRow)
    .filter((c) => platforms.includes(c.platform as ZernioPlatform))
    .filter((c) => c.zernioConversationId && c.zernioAccountId)
    .filter((c) => isBuyReminderCandidate(memoryOf(c.state), now))
    .slice(0, MAX_PER_RUN);
  if (!candidates.length) return { checked: rows.length, sent: 0 };

  // Список задач не прочитался — не знаем, кого продавец ведёт сам: в этот раз никому.
  let openTaskUsers: Set<string>;
  try {
    openTaskUsers = new Set((await loadTasks(ctx)).filter((t) => !t.done).map((t) => t.userKey));
  } catch (e) {
    console.warn(`[buy-reminder:${ctx.tenant.id}] задачи не прочитаны: ${String(e)}`);
    return { checked: rows.length, sent: 0, skipped: "tasks_unreadable" };
  }

  const run: Run = { checked: rows.length, sent: 0 };
  const bump = (k: "manager" | "window" | "task" | "ordered" | "gone") => {
    run[k] = (run[k] ?? 0) + 1;
  };
  /** Отметка без отправки: этот ответ бота больше не смотрим. */
  const markOnly = (customer: (typeof candidates)[number], replyAt: string | undefined) =>
    claimStateSection(ctx, customer, "consultant", (cur) =>
      (cur.followup_for ?? cur.v2_followup_for) === replyAt
        ? null
        : { ...cur, followup_for: replyAt },
    );

  for (const customer of candidates) {
    const memory = memoryOf(customer.state);
    const replyAt = memory.last_reply_at!;
    try {
      if (openTaskUsers.has(customer.userKey)) {
        await markOnly(customer, replyAt);
        bump("task");
        continue;
      }
      // Заказ после ответа бота — человек уже купил (или оформляет): не напоминаем.
      const { count, error } = await ctx.db
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("telegram_id", customer.telegramId)
        .gte("created_at", replyAt);
      if (error) throw serverFailure(`[buy-reminder] заказы не прочитаны: ${error.message}`);
      if (count) {
        await markOnly(customer, replyAt);
        bump("ordered");
        continue;
      }
      const offer = memory.buy_offer!;
      const locale = buyerLocale(ctx, customer);
      const button = await buyOfferButton(
        ctx,
        {
          productId: String(offer.productId),
          ...(typeof offer.variantId === "string" ? { variantId: offer.variantId } : {}),
        },
        locale,
      );
      if (!button) {
        await markOnly(customer, replyAt);
        bump("gone");
        continue;
      }
      // Переписку прочитать не удалось — не знаем, кто в чате и открыто ли окно: ждём.
      const tail = await readTail(customer, transport);
      if (!tail) continue;
      if (managerInChat(customer, memory, tail, now)) {
        await markOnly(customer, replyAt);
        bump("manager");
        continue;
      }
      // Покупатель написал после ответа (или окно закрыто) — напоминать по этому ответу поздно.
      if (buyerWindow(lastIncomingAt(tail), replyAt, now) !== "open") {
        await markOnly(customer, replyAt);
        bump("window");
        continue;
      }

      const text = BUY_REMINDER_TEXT[locale](button.name);
      // Сначала отметка и «свой голос», потом отправка: второй крон уступит,
      // а проверка «в чате менеджер» узнает это сообщение (relayed).
      const marked = await claimStateSection(ctx, customer, "consultant", (cur) =>
        (cur.followup_for ?? cur.v2_followup_for) === replyAt
          ? null
          : {
              ...cur,
              followup_for: replyAt,
              relayed: [...((cur.relayed as string[] | undefined) ?? []), text].slice(-10),
            },
      );
      if (!marked) continue;
      const r = await transport.send(
        customer.zernioConversationId!,
        customer.zernioAccountId!,
        text,
        {
          platform: customer.platform as ZernioPlatform,
          buttons: [button.button],
          idempotencyScope: `buyreminder:${customer.userKey}:${replyAt}`,
        },
      );
      // Не дошло (или неизвестно) — не повторяем: отметка уже стоит.
      if (!r.ok) {
        console.warn(`[buy-reminder:${ctx.tenant.id}] ${customer.userKey}: ${r.error}`);
        continue;
      }
      await updateStateSection(ctx, marked, "consultant", (cur) => ({
        ...cur,
        recent: recentWithFollowUp(cur as FollowUpState, text),
      })).catch((e: unknown) =>
        console.warn(`[buy-reminder:${ctx.tenant.id}] история не записана: ${String(e)}`),
      );
      if (ctx.tenant.modules.manager_chat) {
        const { recordMessage } = await import("@/core/chat/chat");
        await recordMessage(ctx, {
          telegramId: customer.telegramId,
          direction: "out",
          sender: "bot",
          text,
        }).catch(() => {});
      }
      run.sent++;
    } catch (e) {
      // Сбой одного покупателя не останавливает остальных; без отметки — следующий прогон.
      console.error(`[buy-reminder:${ctx.tenant.id}] ${customer.userKey}`, e);
    }
  }
  return run;
}
