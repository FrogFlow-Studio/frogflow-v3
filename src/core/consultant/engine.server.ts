import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { setState } from "@/core/customers/customers";
import { getSettings, setSetting } from "@/core/settings/settings";
import { resolvePrice } from "@/core/pricing/pricing";
import { PRODUCT_SELECT, sortedVariants, type Product } from "@/core/catalog/catalog";
import { isConsultantVertical } from "@/core/verticals/registry";
import { parseKnowledge, retrieveKnowledge, type KnowledgeDoc } from "./knowledge";
import { parseProfile, type ConsultantProfile } from "./profile";
import { buildSystemPrompt, cleanReply, isResetIntent } from "./prompt";
import { addDaily, budgetBlock, limitsFor, parseDaily, today } from "./budget";

/**
 * ИИ-консультант: отвечает покупателю по профилю бизнеса, базе знаний и
 * каталогу; сложное передаёт менеджеру инструментом. Канала не знает —
 * адаптер присылает текст и отправляет ответ. Расход считается на клиента.
 */
export const KEYS = {
  enabled: "consultant_enabled",
  profile: "consultant_profile",
  knowledge: "consultant_knowledge",
  usage: "consultant_usage",
  daily: "consultant_daily",
  lastError: "consultant_last_error",
} as const;

const DEFAULT_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 20_000;
const HISTORY_TURNS = 16;
const CATALOG_LIMIT = 120;
/** Цены Haiku 4.5 за миллион токенов: ввод, вывод, запись в кеш, чтение из кеша. */
const PRICE = { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 };

export type ConsultantTurn = { role: "customer" | "assistant"; text: string };
export type ConsultantState = {
  recent?: ConsultantTurn[];
  paused_until?: string;
  contact?: string;
  last_reply_at?: string;
};

export type Handoff = {
  kind: "handoff" | "lead";
  reason: string;
  customerName?: string;
  customerContact?: string;
  summary: string;
};

export type ConsultantResult = {
  reply: string;
  handoff: Handoff | null;
  usage: { inputTokens: number; outputTokens: number; usd: number };
};

export function consultantConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY?.trim());
}

/** Включён ли консультант у клиента: явный тумблер, а для ниш-консультантов — по умолчанию. */
export async function consultantEnabled(ctx: TenantContext): Promise<boolean> {
  if (!consultantConfigured()) return false;
  const s = await getSettings(ctx, [KEYS.enabled]);
  const v = s[KEYS.enabled];
  if (v === "true") return true;
  if (v === "false") return false;
  return isConsultantVertical(ctx.tenant.vertical);
}

export async function loadConsultant(
  ctx: TenantContext,
): Promise<{ profile: ConsultantProfile; docs: KnowledgeDoc[]; enabled: boolean }> {
  const s = await getSettings(ctx, [KEYS.profile, KEYS.knowledge, KEYS.enabled, "shop_name"]);
  const v = s[KEYS.enabled];
  return {
    profile: parseProfile(s[KEYS.profile], s.shop_name ?? ctx.tenant.name),
    docs: parseKnowledge(s[KEYS.knowledge]),
    enabled:
      v === "true" ? true : v === "false" ? false : isConsultantVertical(ctx.tenant.vertical),
  };
}

/** Каталог одной строкой на товар — наличие и цены только отсюда. */
async function catalogSnippet(ctx: TenantContext): Promise<string> {
  const { data } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .limit(CATALOG_LIMIT);
  const rows = (data ?? []) as Product[];
  const lines = await Promise.all(
    rows.map(async (p) => {
      const variants = sortedVariants(p);
      const priced = variants.length
        ? await Promise.all(
            variants.map(async (v) => ({ v, m: await resolvePrice(ctx, p, null, v) })),
          )
        : [];
      const base = await resolvePrice(ctx, p, null);
      const price = priced.length
        ? priced.map(({ v, m }) => `${v.name} — ${m.amount} ${m.currency}`).join(", ")
        : `${base.amount} ${base.currency}`;
      const stock =
        ctx.tenant.modules.stock && p.stock_quantity != null
          ? p.stock_quantity > 0
            ? `, в наличии ${p.stock_quantity}`
            : ", нет в наличии"
          : "";
      const desc = (p.description ?? "").replace(/\s+/g, " ").slice(0, 160);
      return `- ${p.name}: ${price}${stock}${desc ? `. ${desc}` : ""}`;
    }),
  );
  return lines.join("\n");
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "handoff_to_manager",
    description:
      "Передать диалог живому менеджеру: клиент просит человека, жалуется, задаёт вопрос вне базы знаний и каталога, или готов завершить сделку. Вызывайте вместе с короткой репликой клиенту.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "purchase",
            "book_call",
            "booking",
            "human_requested",
            "complaint",
            "unknown_question",
          ],
        },
        customer_name: { type: "string" },
        customer_contact: {
          type: "string",
          description: "Телефон или другой контакт, если клиент дал",
        },
        summary: { type: "string", description: "Суть запроса и договорённостей, 1–3 предложения" },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "record_order_lead",
    description:
      "Зафиксировать заказ, запись или заявку на звонок, когда параметры и контакт клиента известны.",
    input_schema: {
      type: "object",
      properties: {
        lead_type: { type: "string", enum: ["order", "call", "booking"] },
        customer_name: { type: "string" },
        customer_contact: { type: "string" },
        details: {
          type: "string",
          description: "Товары и количество, повод, дата, время — всё, что нужно менеджеру",
        },
      },
      required: ["lead_type", "details"],
    },
  },
];

function stateOf(customer: Customer): ConsultantState {
  const s = customer.state.consultant;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as ConsultantState) : {};
}

export function isPaused(customer: Customer, now = Date.now()): boolean {
  const until = stateOf(customer).paused_until;
  return Boolean(until) && new Date(until!).getTime() > now;
}

async function saveState(ctx: TenantContext, customer: Customer, patch: Partial<ConsultantState>) {
  const next = { ...stateOf(customer), ...patch };
  return setState(ctx, customer, { ...customer.state, consultant: next as never });
}

/** Продавец подключился сам или клиент ушёл к менеджеру — консультант молчит 12 часов. */
export async function pauseConsultant(ctx: TenantContext, customer: Customer, hours = 12) {
  return saveState(ctx, customer, {
    paused_until: new Date(Date.now() + hours * 3600_000).toISOString(),
  });
}

export async function resumeConsultant(ctx: TenantContext, customer: Customer) {
  return saveState(ctx, customer, { paused_until: undefined, recent: [] });
}

async function recordUsage(
  ctx: TenantContext,
  usd: number,
  inputTokens: number,
  outputTokens: number,
) {
  const s = await getSettings(ctx, [KEYS.usage]);
  let prev = { count: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  try {
    prev = { ...prev, ...(JSON.parse(s[KEYS.usage] || "{}") as object) };
  } catch {
    /* пустое значение */
  }
  await setSetting(
    ctx,
    KEYS.usage,
    JSON.stringify({
      count: prev.count + 1,
      inputTokens: prev.inputTokens + inputTokens,
      outputTokens: prev.outputTokens + outputTokens,
      usd: Math.round((prev.usd + usd) * 1_000_000) / 1_000_000,
    }),
  );
}

/**
 * Один ответ консультанта на сообщение покупателя. Историю держим в
 * bot_users.state.consultant; при handoff — пауза, дальше отвечает человек.
 * `dryRun` — проверка из админки: без истории и без записи состояния.
 */
export async function runConsultant(
  ctx: TenantContext,
  customer: Customer | null,
  text: string,
  opts: {
    platform: string;
    dryRun?: boolean;
    /** Ответ на сторис/рилс — консультант узнаёт товар по тегу продавца. */
    story?: { storyId: string | null; mediaUrl: string | null };
  } = { platform: "telegram" },
): Promise<ConsultantResult | null> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  let incoming = text.trim().slice(0, 1500);
  if (!incoming) return null;
  if (opts.story && (opts.story.storyId || opts.story.mediaUrl)) {
    const { findStoryTag, listStoryTags, storyContextLine } = await import("./story-tags");
    const tag = findStoryTag(await listStoryTags(ctx), opts.story.storyId, opts.story.mediaUrl);
    incoming = `${storyContextLine(tag, opts.story.storyId)}\n\n${incoming}`;
  }

  const { profile, docs } = await loadConsultant(ctx);
  const state = customer ? stateOf(customer) : {};

  if (customer && !opts.dryRun && isResetIntent(incoming)) {
    await resumeConsultant(ctx, customer);
    return {
      reply: `Начнём заново. Я консультант «${profile.brand_name}» — чем помочь?`,
      handoff: null,
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  // Предел на клиента — до вызова модели (core/consultant/budget).
  const kind = opts.dryRun ? "test" : "customer";
  const daily = parseDaily((await getSettings(ctx, [KEYS.daily]))[KEYS.daily], today());
  const blocked = budgetBlock(daily, kind, limitsFor(ctx.tenant.settings.consultant_limits));
  if (blocked) {
    if (opts.dryRun) throw new Error(blocked);
    await setSetting(ctx, KEYS.lastError, `${new Date().toISOString()} — ${blocked}`.slice(0, 500));
    // Как при передаче менеджеру: пауза, чтобы продавец не получал уведомление на каждое сообщение.
    if (customer)
      await saveState(ctx, customer, {
        paused_until: new Date(Date.now() + 12 * 3600_000).toISOString(),
      });
    return {
      reply: "Передам ваш вопрос менеджеру — он ответит в ближайшее время.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `ИИ-консультант на сегодня выключен пределом. Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  const catalog = await catalogSnippet(ctx);
  const system = buildSystemPrompt(profile, retrieveKnowledge(incoming, docs, 6), catalog);
  const session = [
    `Канал: ${opts.platform}`,
    customer?.firstName ? `Имя клиента в профиле: ${customer.firstName}` : "",
    state.contact ? `Контакт клиента, который он уже давал: ${state.contact}` : "",
    `Сейчас: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ]
    .filter(Boolean)
    .join("\n");

  const history: Anthropic.MessageParam[] = (state.recent ?? []).slice(-HISTORY_TURNS).map((t) => ({
    role: t.role === "customer" ? "user" : "assistant",
    content: t.text,
  }));
  // Две реплики одной роли подряд API склеивает сам; первой обязана быть user.
  while (history[0]?.role === "assistant") history.shift();

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  const model = env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 700,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
        { type: "text", text: `ДАННЫЕ ТЕКУЩЕГО ДИАЛОГА:\n${session}` },
      ],
      tools: TOOLS,
      messages: [...history, { role: "user", content: incoming }],
    });

    let reply = "";
    let handoff: Handoff | null = null;
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
      else if (block.type === "tool_use") {
        const input = block.input as Record<string, string | undefined>;
        if (block.name === "handoff_to_manager")
          handoff = {
            kind: "handoff",
            reason: input.reason ?? "human_requested",
            customerName: input.customer_name,
            customerContact: input.customer_contact,
            summary: input.summary ?? "",
          };
        else if (block.name === "record_order_lead")
          handoff = {
            kind: "lead",
            reason: input.lead_type ?? "order",
            customerName: input.customer_name,
            customerContact: input.customer_contact,
            summary: input.details ?? "",
          };
      }
    }
    if (response.stop_reason === "refusal") {
      reply = "Передам ваш вопрос менеджеру — он ответит в ближайшее время.";
      handoff = handoff ?? {
        kind: "handoff",
        reason: "unknown_question",
        summary: incoming.slice(0, 300),
      };
    }
    reply = cleanReply(reply);
    if (!reply && handoff)
      reply =
        handoff.kind === "lead"
          ? "Спасибо, всё записал и передал менеджеру — он свяжется с вами для подтверждения."
          : "Передаю диалог менеджеру — он ответит в ближайшее время.";
    if (!reply) reply = "Уточните, пожалуйста, что именно вас интересует — подскажу.";

    const u = response.usage;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const usd =
      (u.input_tokens * PRICE.in +
        cacheWrite * PRICE.cacheWrite +
        cacheRead * PRICE.cacheRead +
        u.output_tokens * PRICE.out) /
      1_000_000;
    await recordUsage(ctx, usd, u.input_tokens + cacheWrite + cacheRead, u.output_tokens);
    await setSetting(ctx, KEYS.daily, JSON.stringify(addDaily(daily, usd, kind)));
    await setSetting(ctx, KEYS.lastError, "");

    if (customer && !opts.dryRun) {
      const recent: ConsultantTurn[] = [
        ...(state.recent ?? []),
        { role: "customer" as const, text: incoming.slice(0, 500) },
        { role: "assistant" as const, text: reply.slice(0, 700) },
      ].slice(-HISTORY_TURNS);
      await saveState(ctx, customer, {
        recent,
        last_reply_at: new Date().toISOString(),
        ...(handoff?.customerContact ? { contact: handoff.customerContact } : {}),
        ...(handoff ? { paused_until: new Date(Date.now() + 12 * 3600_000).toISOString() } : {}),
      });
    }
    return {
      reply,
      handoff,
      usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens, usd },
    };
  } catch (e) {
    const detail =
      e instanceof Anthropic.APIError
        ? `HTTP ${e.status ?? "?"}: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.error(`[consultant:${ctx.tenant.id}]`, detail);
    await setSetting(ctx, KEYS.lastError, `${new Date().toISOString()} — ${detail}`.slice(0, 500));
    return {
      reply: "Сейчас не могу ответить — передаю вопрос менеджеру, он напишет вам.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `Сбой консультанта. Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
}
