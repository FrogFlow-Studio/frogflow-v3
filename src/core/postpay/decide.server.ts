/**
 * ИИ после оплаты: факты заказа и вызов модели (правила — postpay.ts).
 * Ключ платформы, как у наблюдателя: копейки на ответ, потолок в день на
 * клиента. Любой сбой — «pass»: сообщение идёт прежним путём, к продавцу.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import type { Customer } from "@/core/customers/customers";
import { listOrderEvents } from "@/core/orders/events";
import type { OrderWithItems } from "@/core/orders/orders";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
import { todayInZone } from "@/core/preorder/preorder";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { previewReadonly } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import {
  DECIDE_TOOL,
  POSTPAY_CAP_KEY,
  POSTPAY_ENABLED_KEY,
  POSTPAY_MAX_TEXT,
  POSTPAY_MODEL,
  POSTPAY_STATUSES,
  POSTPAY_SYSTEM,
  POSTPAY_TIMEOUT_MS,
  POSTPAY_WINDOW_DAYS,
  costUsd,
  parseCap,
  parseDecision,
  parseSpend,
  postpaySpendKey,
  postpayUserPrompt,
  type ChatLine,
  type PostPayDecision,
  type PostPayFacts,
  type PostPayStatus,
} from "./postpay";

const HISTORY = 8;

/**
 * Последний заказ покупателя после оплаты за POSTPAY_WINDOW_DAYS: цифровой, из
 * переписки (не Telegram и не сайт). Нет такого — null, модель не зовём.
 */
export async function postpayOrder(
  ctx: TenantContext,
  customer: Customer,
  now = Date.now(),
): Promise<OrderWithItems | null> {
  const since = new Date(now - POSTPAY_WINDOW_DAYS * 86_400_000).toISOString();
  // Один последний заказ — нужен именно он, это не обрезка списка.
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("telegram_id", customer.telegramId)
    .gte("updated_at", since)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`ИИ после оплаты: заказ не прочитан: ${error.message}`);
  const o = data as OrderWithItems | null;
  if (!o || !(POSTPAY_STATUSES as readonly string[]).includes(o.status)) return null;
  if (o.fulfillment_kind === "physical" || o.platform === "telegram" || o.platform === "web")
    return null;
  return o;
}

export async function postpayFacts(ctx: TenantContext, o: OrderWithItems): Promise<PostPayFacts> {
  const events = await listOrderEvents(ctx, o.id);
  const sent = events.filter((e) => e.kind === "email_sent" && e.payload.kind !== "notice");
  const mailEvents = events.filter((e) => e.kind === "email_sent" || e.kind === "email_failed");
  return {
    orderId: o.id,
    orderNo: Number(o.display_no ?? o.order_no),
    status: o.status as PostPayStatus,
    items: (o.order_items ?? []).map((i) => i.name_snapshot),
    email: o.customer_email?.trim() || null,
    emailSentAt: sent.at(-1)?.at ?? null,
    emailFailed: mailEvents.at(-1)?.kind === "email_failed",
    resends: events.filter((e) => e.kind === "email_resend").length,
  };
}

async function recentLines(ctx: TenantContext, telegramId: number): Promise<ChatLine[]> {
  const { data, error } = await ctx.db
    .from("manager_chat_messages")
    .select("id, sender, text, created_at")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY);
  // История — подсказка модели: без неё решение по одному сообщению.
  if (error) {
    console.warn(`[postpay:${ctx.tenant.id}] история: ${error.message}`);
    return [];
  }
  return (data ?? [])
    .map((r) => ({ sender: r.sender, text: r.text ?? "", at: r.created_at }))
    .reverse();
}

export type CallModel = (
  system: string,
  user: string,
) => Promise<{ input: unknown; usage?: { input_tokens?: number; output_tokens?: number } }>;

const liveModel: CallModel = async (system, user) => {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан");
  const res = await new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: POSTPAY_TIMEOUT_MS,
  }).messages.create({
    model: POSTPAY_MODEL,
    max_tokens: 200,
    system,
    tools: [DECIDE_TOOL],
    tool_choice: { type: "tool", name: DECIDE_TOOL.name },
    messages: [{ role: "user", content: user }],
    ...modelParams(POSTPAY_MODEL),
  } as never);
  const r = res as unknown as {
    content: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const tool = r.content.find((b) => b.type === "tool_use" && b.name === DECIDE_TOOL.name);
  return { input: tool?.input ?? null, usage: r.usage };
};

let modelOverride: CallModel | null = null;
/** Тесты: подставить ответ модели. */
export function setPostpayModelForTests(fn: CallModel | null) {
  modelOverride = fn;
}

const PASS: PostPayDecision = { action: "pass", email: null };

/**
 * Что просит покупатель с оплаченным заказом. Выключено у клиента, потолок
 * дня исчерпан, сбой модели — pass.
 */
export async function decidePostPay(
  ctx: TenantContext,
  p: { customer: Customer; facts: PostPayFacts; text: string; now?: number },
): Promise<PostPayDecision> {
  const now = p.now ?? Date.now();
  const text = p.text.trim();
  if (!text || text.length > POSTPAY_MAX_TEXT) return PASS;
  // Предпросмотр (ветка на Vercel) в живую модель не ходит.
  if (previewReadonly()) return PASS;
  if ((await getSetting(ctx, POSTPAY_ENABLED_KEY))?.trim() === "off") return PASS;
  const date = todayInZone(ctx.timezone, new Date(now));
  const key = postpaySpendKey(date);
  const cap = parseCap(await getSetting(ctx, POSTPAY_CAP_KEY));
  if (parseSpend(await getSetting(ctx, key)).usd >= cap) return PASS;
  const lines = await recentLines(ctx, p.customer.telegramId);
  const user = postpayUserPrompt({ facts: p.facts, lines, text, timezone: ctx.timezone, now });
  let answer: Awaited<ReturnType<CallModel>>;
  try {
    answer = await (modelOverride ?? liveModel)(POSTPAY_SYSTEM, user);
  } catch (e) {
    console.warn(`[postpay:${ctx.tenant.id}] модель: ${String(e)}`);
    return PASS;
  }
  const usd = costUsd(answer.usage);
  await updateSettingAtomic(ctx, key, (raw) => {
    const s = parseSpend(raw);
    return JSON.stringify({ usd: Math.round((s.usd + usd) * 1e6) / 1e6, calls: s.calls + 1 });
  });
  return parseDecision(answer.input, text);
}
