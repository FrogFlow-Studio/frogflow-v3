/**
 * Разбор свободной реплики перед обращением — вызов модели (правила — triage.ts).
 * Ключ платформы, как у ИИ после оплаты и страны: доли цента на сообщение,
 * потолок в день на клиента. Обе настройки выключены, модели нет, потолок
 * исчерпан, сбой — «other»: сообщение идёт прежним путём, к продавцу.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import type { Customer } from "@/core/customers/customers";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
import { todayInZone } from "@/core/preorder/preorder";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { previewReadonly } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import { parseSpend } from "@/core/postpay/postpay";
import { CHAT_RECEIPT_TEXT_KEY, receiptTextOn } from "@/core/receipts/text-receipt";
import {
  CHAT_FOREIGN_PAY_KEY,
  CHAT_PAY_FAILED_KEY,
  CHAT_RECEIPT_TEXT_OFFER_KEY,
  CHAT_SKIP_CHATTER_KEY,
  TRIAGE_CAP_KEY,
  TRIAGE_MAX_TEXT,
  TRIAGE_MODEL,
  TRIAGE_OTHER,
  TRIAGE_SYSTEM,
  TRIAGE_TIMEOUT_MS,
  TRIAGE_TOOL,
  foreignPayOn,
  parseTriage,
  payFailedOn,
  receiptTextOfferOn,
  parseTriageCap,
  skipChatterOn,
  triageCostUsd,
  triageSpendKey,
  triageUserPrompt,
  type Triage,
  type TriageLine,
} from "./triage";

const HISTORY = 6;

export type CallTriageModel = (
  system: string,
  user: string,
) => Promise<{ input: unknown; usage?: { input_tokens?: number; output_tokens?: number } }>;

const liveModel: CallTriageModel = async (system, user) => {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан");
  const res = await new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: TRIAGE_TIMEOUT_MS,
  }).messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 100,
    system,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: TRIAGE_TOOL.name },
    messages: [{ role: "user", content: user }],
    ...modelParams(TRIAGE_MODEL),
  } as never);
  const r = res as unknown as {
    content: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const block = r.content.find((b) => b.type === "tool_use" && b.name === TRIAGE_TOOL.name);
  return { input: block?.input ?? null, usage: r.usage };
};

let modelOverride: CallTriageModel | null = null;
/** Тесты: подставить ответ модели. */
export function setTriageModelForTests(fn: CallTriageModel | null) {
  modelOverride = fn;
}

function modelReady(): boolean {
  if (modelOverride) return true;
  try {
    if (previewReadonly()) return false;
    return Boolean(env().ANTHROPIC_API_KEY?.trim());
  } catch {
    // Окружение не настроено — модели нет, прежний путь.
    return false;
  }
}

async function recentLines(ctx: TenantContext, telegramId: number): Promise<TriageLine[]> {
  // Последние реплики — подсказка модели («+» в ответ на что); не обрезка списка.
  const { data, error } = await ctx.db
    .from("manager_chat_messages")
    .select("id, sender, text, created_at")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY + 1);
  if (error) {
    console.warn(`[triage:${ctx.tenant.id}] история: ${error.message}`);
    return [];
  }
  const rows = (data ?? []).map((r) => ({ sender: r.sender, text: r.text ?? "" })).reverse();
  // Последняя строка — обычно само сообщение покупателя: оно в промпте отдельно.
  return rows.slice(0, HISTORY);
}

export type TriageSwitches = {
  chatter: boolean;
  foreignPay: boolean;
  payFailed: boolean;
  receiptTextOffer: boolean;
  receiptText: boolean;
};

/** Что включено у клиента: всё выключено — модель не зовём. */
export async function triageSwitches(ctx: TenantContext): Promise<TriageSwitches> {
  const [chatter, foreignPay, payFailed, offer, receiptText] = await Promise.all([
    getSetting(ctx, CHAT_SKIP_CHATTER_KEY),
    getSetting(ctx, CHAT_FOREIGN_PAY_KEY),
    getSetting(ctx, CHAT_PAY_FAILED_KEY),
    getSetting(ctx, CHAT_RECEIPT_TEXT_OFFER_KEY),
    getSetting(ctx, CHAT_RECEIPT_TEXT_KEY),
  ]);
  return {
    chatter: skipChatterOn(chatter),
    foreignPay: foreignPayOn(foreignPay),
    payFailed: payFailedOn(payFailed),
    receiptTextOffer: receiptTextOfferOn(offer),
    receiptText: receiptTextOn(receiptText),
  };
}

const SWITCH_OF: Record<Exclude<Triage["kind"], "other">, keyof TriageSwitches> = {
  chatter: "chatter",
  foreign_pay: "foreignPay",
  payment_failed: "payFailed",
  cant_send_receipt: "receiptTextOffer",
  text_receipt: "receiptText",
  // Ещё раз шаг оплаты — продолжение «платёж не прошёл, какой у вас банк».
  how_to_pay: "payFailed",
};

/**
 * Что это за сообщение. Выключенный вид становится «other»: решение
 * исполняется только для включённых настроек.
 */
export async function triageMessage(
  ctx: TenantContext,
  p: { customer: Customer; text: string; now?: number; withPhoto?: boolean },
): Promise<Triage> {
  const text = p.text.trim();
  if (!text || text.length > TRIAGE_MAX_TEXT) return TRIAGE_OTHER;
  const on = await triageSwitches(ctx);
  if (!Object.values(on).some(Boolean)) return TRIAGE_OTHER;
  if (!modelReady()) return TRIAGE_OTHER;
  const date = todayInZone(ctx.timezone, new Date(p.now ?? Date.now()));
  const key = triageSpendKey(date);
  const cap = parseTriageCap(await getSetting(ctx, TRIAGE_CAP_KEY));
  if (parseSpend(await getSetting(ctx, key)).usd >= cap) return TRIAGE_OTHER;
  const lines = await recentLines(ctx, p.customer.telegramId);
  let answer: Awaited<ReturnType<CallTriageModel>>;
  try {
    answer = await (modelOverride ?? liveModel)(
      TRIAGE_SYSTEM,
      triageUserPrompt({ text, lines, withPhoto: p.withPhoto }),
    );
  } catch (e) {
    console.warn(`[triage:${ctx.tenant.id}] модель: ${String(e)}`);
    return TRIAGE_OTHER;
  }
  const usd = triageCostUsd(answer.usage);
  await updateSettingAtomic(ctx, key, (raw) => {
    const s = parseSpend(raw);
    return JSON.stringify({ usd: Math.round((s.usd + usd) * 1e6) / 1e6, calls: s.calls + 1 });
  }).catch((e: unknown) => console.warn(`[triage:${ctx.tenant.id}] расход: ${String(e)}`));
  const t = parseTriage(answer.input);
  if (t.kind !== "other" && !on[SWITCH_OF[t.kind]]) return TRIAGE_OTHER;
  return t;
}
