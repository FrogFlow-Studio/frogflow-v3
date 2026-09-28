import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { updateStateSection } from "@/core/customers/customers";
import { getSettings, trySetSetting, updateSettingAtomic } from "@/core/settings/settings";
import { resolvePrice } from "@/core/pricing/pricing";
import { PRODUCT_SELECT, sortedVariants, type Product } from "@/core/catalog/catalog";
import { isConsultantVertical } from "@/core/verticals/registry";
import { parseKnowledge, retrieveKnowledge, type KnowledgeDoc } from "./knowledge";
import { parseProfile, type ConsultantProfile } from "./profile";
import { buildSystemPrompt, cleanReply, isResetIntent } from "./prompt";
import { checkReplyFacts, knownNumbers } from "./price-check";
import {
  CATALOG_TOOL_NAMES,
  CATALOG_TOOLS,
  catalogPromptSection,
  catalogSearchEnabled,
  loadCatalog,
  runCatalogTool,
} from "./catalog-tool.server";
import { pauseHours, pausedUntilIso } from "./pause";
import { takeAiCall } from "./rate.server";
import { serverFailure } from "@/lib/server-failure";
import {
  ASK_CONTACT_RESULT,
  formatProfile,
  isPurchaseHandoff,
  mergeProfile,
  parseProfile as parseMemory,
  phoneIn,
  REMEMBER_TOOL,
  type CustomerProfile,
} from "./memory";
import {
  budgetBlock,
  limitsFor,
  parseDaily,
  parseMonthly,
  reserveDaily,
  RESERVE_USD,
  settleRaw,
  startsNewDialog,
  today,
} from "./budget";

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
  dialogs: "consultant_dialogs_month",
  lastError: "consultant_last_error",
} as const;

const DEFAULT_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 20_000;
const HISTORY_TURNS = 16;
/** Раундов с инструментами каталога на одно сообщение (v1: 4). */
export const MAX_ROUNDS = 4;
/**
 * Общий потолок времени всех вызовов модели на одно сообщение с поиском:
 * каждый вызов получает таймаут по остатку, меньше MIN_CALL_MS на вызов —
 * нового не начинаем, вопрос уходит менеджеру.
 */
export const ROUNDS_DEADLINE_MS = 35_000;
const MIN_CALL_MS = 3_000;
const CATALOG_LIMIT = 120;
/** Цены Haiku 4.5 за миллион токенов: ввод, вывод, запись в кеш, чтение из кеша. */
/**
 * Ставки Haiku 4.5, $ за миллион токенов. Кеш промпта держим час, как в v1
 * (fix «hold the cache for an hour»): покупатель отвечает через минуты, а не
 * секунды, и пятиминутный кеш остывал к следующему сообщению. Запись в
 * часовой кеш — вдвое дороже входа, чтение — десятая часть.
 */
export const CACHE_TTL = "1h" as const;
const PRICE = { in: 1, out: 5, cacheWrite: 2, cacheRead: 0.1 };
/** Sonnet — консультант по прайсу может работать на нём (настройка consultant_model). */
const PRICE_SONNET = { in: 3, out: 15, cacheWrite: 6, cacheRead: 0.3 };
/**
 * Вызовов модели на одно сообщение консультанта по прайсу, на которые
 * бронируется бюджет: четыре раунда, переспрос о рублях, два на сверку
 * черновика и последний без инструментов.
 */
const PRICELIST_RESERVE_CALLS = 8;

export type ConsultantTurn = { role: "customer" | "assistant"; text: string };
export type ConsultantState = {
  recent?: ConsultantTurn[];
  paused_until?: string;
  contact?: string;
  last_reply_at?: string;
  /** Что покупатель уже сказал (core/consultant/memory) — расширенный режим. */
  profile?: CustomerProfile;
  /** Телефон перед покупкой уже спрашивали — второй раз не спрашиваем. */
  contact_asked?: boolean;
  /** Когда человек вернул диалог боту — проверка менеджера не смотрит раньше. */
  resumed_at?: string;
  /** Ответы менеджера, пересланные из Telegram (core/consultant/relay), — последние 10. */
  relayed?: string[];
  /** Консультант по прайсу: покупатель смотрит цены в рублях (переводит код). */
  rub?: boolean;
  /** Консультант по прайсу: файлы фотобазы, которые покупатель уже получил. */
  media_sent?: string[];
  /** Консультант по прайсу: товары последних ответов — для «а другой цвет?». */
  last_product_ids?: string[];
  /** Напоминание замолчавшему покупателю уже ушло после ответа с этим временем. */
  followup_for?: string;
  /** Имена v1 у диалогов BOVI, начатых до переезда (читаются, не пишутся). */
  v2_profile?: CustomerProfile;
  v2_rub?: boolean;
  v2_contact_asked?: boolean;
  v2_media_sent?: string[];
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
  usage: {
    inputTokens: number;
    outputTokens: number;
    usd: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
  /** Модель ответа — для журнала ответов (core/consultant/runs). */
  model?: string;
  /** Курс рубля, по которому консультант по прайсу считал цены. */
  rate?: { value: number; updatedAt: string; source: string | null } | null;
  /**
   * Что делал консультант по порядку: имена вызванных инструментов, а также
   * `ask_contact` (спросил телефон вместо передачи). Для журнала ответов в
   * каналах.
   */
  tools?: string[];
  /** Фото и видео товара к ответу (консультант по прайсу, send_product_photo). */
  attachments?: { url: string; kind: "image" | "video" }[];
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
/** Каталог для подсказки и цены из него — для сверки ответа (price-check). */
async function catalogSnippet(ctx: TenantContext): Promise<{ text: string; prices: number[] }> {
  const { data } = await ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .order("sort_order")
    .limit(CATALOG_LIMIT);
  const rows = (data ?? []) as Product[];
  const prices: number[] = [];
  const lines = await Promise.all(
    rows.map(async (p) => {
      const variants = sortedVariants(p);
      const priced = variants.length
        ? await Promise.all(
            variants.map(async (v) => ({ v, m: await resolvePrice(ctx, p, null, v) })),
          )
        : [];
      const base = await resolvePrice(ctx, p, null);
      prices.push(base.amount, ...priced.map(({ m }) => m.amount));
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
  return { text: lines.join("\n"), prices };
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

/**
 * История диалога — отдельными сообщениями Anthropic, а не одной строкой.
 * Первой идёт реплика покупателя, соседние реплики одной роли склеиваются
 * (два сообщения покупателя подряд, пока бот молчал).
 */
export function buildConsultantMessages(
  recent: readonly ConsultantTurn[],
  incoming?: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const turns = recent.slice(-HISTORY_TURNS).map((t) => ({
    role: t.role === "customer" ? ("user" as const) : ("assistant" as const),
    content: t.text,
  }));
  if (incoming !== undefined) turns.push({ role: "user", content: incoming });
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of turns) {
    if (!t.content.trim()) continue;
    if (!out.length && t.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last?.role === t.role) last.content = `${last.content}\n\n${t.content}`;
    else out.push({ ...t });
  }
  return out;
}

function stateOf(customer: Customer): ConsultantState {
  const s = customer.state.consultant;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as ConsultantState) : {};
}

export function isPaused(customer: Customer, now = Date.now()): boolean {
  const until = stateOf(customer).paused_until;
  return Boolean(until) && new Date(until!).getTime() > now;
}

/**
 * Записать изменения поверх свежего состояния: пока модель думала, бот или
 * второе сообщение могли записать своё (core/customers updateStateSection).
 * Профиль покупателя сливается: новое поверх того, что узнали параллельно.
 */
async function saveState(ctx: TenantContext, customer: Customer, patch: Partial<ConsultantState>) {
  return updateStateSection(ctx, customer, "consultant", (current) => {
    const next: Record<string, unknown> = { ...current, ...patch };
    if (patch.profile) next.profile = { ...parseMemory(current.profile), ...patch.profile };
    return next;
  });
}

/**
 * Продавец ответил сам или клиент ушёл к менеджеру — консультант молчит
 * столько, сколько выбрал продавец (core/consultant/pause, по умолчанию 12 ч).
 */
export async function pauseConsultant(ctx: TenantContext, customer: Customer) {
  return saveState(ctx, customer, { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) });
}

/**
 * Менеджер ответил из Telegram на уведомление о передаче: пауза продлевается,
 * текст запоминается — проверка «менеджер в чате» не примет его за чужого.
 */
export async function recordRelayedReply(ctx: TenantContext, customer: Customer, text: string) {
  const prev = stateOf(customer).relayed ?? [];
  return saveState(ctx, customer, {
    paused_until: pausedUntilIso(pauseHours(ctx.tenant)),
    relayed: [...prev, text].slice(-10),
  });
}

/** До какого времени консультант молчит в диалоге; null — не молчит. */
export function pausedUntil(customer: Customer, now = Date.now()): string | null {
  return isPaused(customer, now) ? (stateOf(customer).paused_until ?? null) : null;
}

export async function resumeConsultant(ctx: TenantContext, customer: Customer) {
  return saveState(ctx, customer, {
    paused_until: undefined,
    resumed_at: new Date().toISOString(),
    recent: [],
    profile: undefined,
    contact_asked: undefined,
    rub: undefined,
    media_sent: undefined,
    last_product_ids: undefined,
    v2_profile: undefined,
    v2_rub: undefined,
    v2_contact_asked: undefined,
    v2_media_sent: undefined,
  });
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
  await trySetSetting(
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
    /** Фото покупателя: ссылки (директ) или уже скачанные (Telegram) — консультант по прайсу. */
    imageUrls?: string[];
    images?: import("./pricelist/images").V2Image[];
  } = { platform: "telegram" },
): Promise<ConsultantResult | null> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const { pricelistMode } = await import("./pricelist/mode");
  const pricelist = pricelistMode(ctx.tenant);
  const photos = (opts.imageUrls?.length ?? 0) + (opts.images?.length ?? 0) > 0;
  let incoming = text.trim().slice(0, 1500);
  // По прайсу фото без подписи — тоже вопрос: модель смотрит на снимок.
  if (!incoming && !(pricelist && photos)) return null;
  // По прайсу товары публикации приходят пометкой (pricelist/engine.server).
  if (!pricelist && opts.story && (opts.story.storyId || opts.story.mediaUrl)) {
    const { findStoryTag, listStoryTags, storyContextLine } = await import("./story-tags");
    const tag = findStoryTag(await listStoryTags(ctx), opts.story.storyId, opts.story.mediaUrl);
    incoming = `${storyContextLine(tag, opts.story.storyId)}\n\n${incoming}`;
  }

  const { profile, docs } = await loadConsultant(ctx);
  const state = customer ? stateOf(customer) : {};

  if (customer && !opts.dryRun && isResetIntent(incoming)) {
    await resumeConsultant(ctx, customer);
    return {
      reply: pricelist
        ? "Начнём заново. Что подсказать?"
        : `Начнём заново. Я консультант «${profile.brand_name}» — чем помочь?`,
      handoff: null,
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
  // Попытка взломать подсказку — менеджеру, модель её не видит (v1 BOVI).
  if (pricelist) {
    const { looksLikePromptInjection } = await import("./pricelist/finalize");
    if (looksLikePromptInjection(incoming)) {
      if (customer && !opts.dryRun)
        await saveState(ctx, customer, { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) });
      return {
        reply: "Передам ваш вопрос менеджеру — он ответит в ближайшее время.",
        handoff: {
          kind: "handoff",
          reason: "injection",
          summary: `Сообщение похоже на попытку управлять ботом: «${incoming.slice(0, 200)}»`,
        },
        usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      };
    }
  }

  // Предел на клиента — до вызова модели (core/consultant/budget).
  const kind = opts.dryRun ? "test" : "customer";
  const date = today();
  const budgetLimits = limitsFor(ctx.tenant.settings.consultant_limits);
  const daily = parseDaily((await getSettings(ctx, [KEYS.daily]))[KEYS.daily], date);
  const overBudget = async (blocked: string): Promise<ConsultantResult> => {
    if (opts.dryRun) throw new Error(blocked);
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${blocked}`.slice(0, 500),
    );
    // Как при передаче менеджеру: пауза, чтобы продавец не получал уведомление на каждое сообщение.
    if (customer)
      await saveState(ctx, customer, {
        paused_until: pausedUntilIso(pauseHours(ctx.tenant)),
      });
    return {
      reply: "Передам ваш вопрос менеджеру — он ответит в ближайшее время.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `ИИ-консультант выключен: ${blocked} Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  };
  const early = budgetBlock(daily, kind, budgetLimits);
  if (early) return overBudget(early);

  // Лимит ИИ-диалогов плана на месяц: новый диалог сверх лимита — сразу менеджеру.
  const newDialog = Boolean(customer) && !opts.dryRun && startsNewDialog(state.last_reply_at);
  const { tenantLimits, monthOf } = await import("@/core/plans/tenant");
  const limits = tenantLimits(ctx.tenant);
  const dialogs = parseMonthly((await getSettings(ctx, [KEYS.dialogs]))[KEYS.dialogs], monthOf());
  if (newDialog && limits?.aiDialogs != null && dialogs.count >= limits.aiDialogs) {
    const reason = `Лимит ИИ-диалогов плана на месяц (${limits.aiDialogs}) исчерпан — новые обращения уходят менеджеру.`;
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${reason}`.slice(0, 500),
    );
    if (customer)
      await saveState(ctx, customer, {
        paused_until: pausedUntilIso(pauseHours(ctx.tenant)),
      });
    return {
      reply: "Передам ваш вопрос менеджеру — он ответит в ближайшее время.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `ИИ-консультант: исчерпан лимит диалогов плана. Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  // Большой каталог — инструментом поиска (флаг оператора), иначе первые товары в подсказке.
  const searchMode = !pricelist && catalogSearchEnabled(ctx);
  let loaded: Awaited<ReturnType<typeof loadCatalog>> | null = null;
  try {
    loaded = searchMode ? await loadCatalog(ctx) : null;
  } catch (e) {
    // Каталог не прочитался — покупатель не остаётся без ответа: вопрос менеджеру.
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — каталог для консультанта не прочитан: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        500,
      ),
    );
    if (opts.dryRun) throw serverFailure("Каталог не прочитался. Попробуйте ещё раз.");
    return {
      reply: "Сейчас не могу ответить — передаю вопрос менеджеру, он напишет вам.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `Сбой чтения каталога. Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }
  const catalog = loaded
    ? { text: catalogPromptSection(loaded), prices: [] as number[] }
    : await catalogSnippet(ctx);
  const system = buildSystemPrompt(profile, retrieveKnowledge(incoming, docs, 6), catalog.text, {
    catalogTools: Boolean(loaded),
  });
  let known = loaded ? parseMemory(state.profile) : {};
  const profile0 = known;
  const session = [
    `Канал: ${opts.platform}`,
    customer?.firstName ? `Имя клиента в профиле: ${customer.firstName}` : "",
    state.contact ? `Контакт клиента, который он уже давал: ${state.contact}` : "",
    loaded && formatProfile(profile0)
      ? `Что известно о покупателе: ${formatProfile(profile0)}`
      : "",
    `Сейчас: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ]
    .filter(Boolean)
    .join("\n");

  const history = buildConsultantMessages(state.recent ?? []);

  // Бронь бюджета — проверка и прибавка одной атомарной записью: параллельные
  // сообщения видят брони друг друга и не проскакивают мимо предела.
  // С поиском — бронь на все раунды сразу: у потолка параллельные сообщения
  // видят полную цену друг друга, а не одного вызова.
  const reserveUsd = pricelist
    ? RESERVE_USD * PRICELIST_RESERVE_CALLS
    : loaded
      ? RESERVE_USD * MAX_ROUNDS
      : RESERVE_USD;
  let reserveBlock: string | null = null;
  const reserved = await updateSettingAtomic(ctx, KEYS.daily, (raw) => {
    const r = reserveDaily(parseDaily(raw, date), kind, budgetLimits, reserveUsd);
    if ("blocked" in r) {
      reserveBlock = r.blocked;
      return null;
    }
    return JSON.stringify(r.next);
  });
  if (reserveBlock) return overBudget(reserveBlock);
  // Сбой базы или гонка не выиграна: без брони модель не зовём, но и паузу
  // не ставим — это не исчерпанный предел.
  if (reserved !== "written") {
    if (opts.dryRun) throw new Error("Не удалось записать расход ИИ. Попробуйте ещё раз.");
    return {
      reply: "Сейчас не могу ответить — передаю вопрос менеджеру, он напишет вам.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `Сбой учёта расхода консультанта. Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  // ИИ-баланс клиента (core/ai/balance): кончился — вопрос менеджеру, как при пределе.
  const { aiReserve, aiSettle, aiRelease } = await import("@/core/ai/balance");
  // Бронь — на все раунды сразу, как дневной расход выше: расчёт один, после цикла.
  const aiHold = await aiReserve(ctx, "consultant", reserveUsd);
  if (typeof aiHold === "string") {
    await updateSettingAtomic(ctx, KEYS.daily, (raw) => settleRaw(raw, date, reserveUsd, 0));
    if (aiHold === "short")
      return overBudget(
        "ИИ-баланс клиента закончился — вопросы уходят менеджеру, пока баланс не пополнят.",
      );
    // Сбой учёта баланса — не пустой баланс: без паузы, как сбой дневного расхода.
    if (opts.dryRun) throw serverFailure("Не удалось записать расход ИИ. Попробуйте ещё раз.");
    return {
      reply: "Сейчас не могу ответить — передаю вопрос менеджеру, он напишет вам.",
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `Сбой учёта ИИ-баланса. Клиент написал: «${incoming.slice(0, 200)}»`,
      },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  const baseModel = env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL;
  // Модель «по прайсу» читается из настроек — сбой здесь, до try ниже, не держит бронь.
  const model = pricelist
    ? await import("./pricelist/engine.server")
        .then((m) => m.pricelistModel(ctx, baseModel))
        .catch(async (e: unknown) => {
          await aiRelease(ctx, aiHold);
          throw e;
        })
    : baseModel;
  const price = /sonnet/.test(model) ? PRICE_SONNET : PRICE;
  const u = { input_tokens: 0, output_tokens: 0, cacheWrite: 0, cacheRead: 0 };
  const costUsd = () =>
    (u.input_tokens * price.in +
      u.cacheWrite * price.cacheWrite +
      u.cacheRead * price.cacheRead +
      u.output_tokens * price.out) /
    1_000_000;
  // Расход записан и бронь закрыта — catch второй раз их не трогает.
  let settled = false;
  const toolsUsed: string[] = [];
  const started = Date.now();
  const deadline = started + ROUNDS_DEADLINE_MS;
  /**
   * Один вызов модели. С поиском время ограничено общим потолком: таймаут —
   * остаток до него, повтор — только если остатка хватит на два вызова.
   * Каждый вызов проходит лимит частоты (core/consultant/rate.server).
   */
  const callModel = async (
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message | "limited" | "late"> => {
    const left = deadline - Date.now();
    const bounded = Boolean(loaded) || pricelist;
    if (bounded && left < MIN_CALL_MS) return "late";
    if (!(await takeAiCall(ctx))) return "limited";
    const response = bounded
      ? await client.messages.create(params, {
          timeout: Math.min(TIMEOUT_MS, left),
          // Повтор не уложится в потолок: таймаут вызова — до 20 с из 35.
          maxRetries: 0,
          signal: AbortSignal.timeout(left),
        })
      : await client.messages.create(params);
    u.input_tokens += response.usage.input_tokens;
    u.output_tokens += response.usage.output_tokens;
    u.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    u.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    return response;
  };
  /**
   * Ответ готов: расход записан, бронь закрыта, история и состояние — в
   * диалог. Общее для обычного консультанта и консультанта по прайсу.
   */
  const finish = async (out: {
    reply: string;
    handoff: Handoff | null;
    clearError: boolean;
    patch: Partial<ConsultantState>;
    /** В историю, если покупателю ушло другое (рубли вместо тенге). */
    historyReply?: string;
    attachments?: ConsultantResult["attachments"];
    rate?: ConsultantResult["rate"];
  }): Promise<ConsultantResult> => {
    const { reply, handoff } = out;
    const usd = costUsd();
    settled = true;
    // ИИ-баланс клиента: все раунды (и по прайсу) по фактической цене API, один расчёт брони.
    await aiSettle(ctx, aiHold, usd);
    await recordUsage(ctx, usd, u.input_tokens + u.cacheWrite + u.cacheRead, u.output_tokens);
    await updateSettingAtomic(ctx, KEYS.daily, (raw) => settleRaw(raw, date, reserveUsd, usd));
    if (newDialog)
      await trySetSetting(
        ctx,
        KEYS.dialogs,
        JSON.stringify({ month: dialogs.month, count: dialogs.count + 1 }),
      );
    if (out.clearError) await trySetSetting(ctx, KEYS.lastError, "");

    if (customer && !opts.dryRun) {
      const recent: ConsultantTurn[] = [
        ...(state.recent ?? []),
        { role: "customer" as const, text: incoming.slice(0, 500) },
        { role: "assistant" as const, text: (out.historyReply || reply).slice(0, 700) },
      ].slice(-HISTORY_TURNS);
      // Ответ уже готов и оплачен: сбой записи истории его не отменяет.
      try {
        await saveState(ctx, customer, {
          recent,
          last_reply_at: new Date().toISOString(),
          ...(handoff?.customerContact ? { contact: handoff.customerContact } : {}),
          ...out.patch,
          ...(handoff ? { paused_until: pausedUntilIso(pauseHours(ctx.tenant)) } : {}),
        });
      } catch (e) {
        console.error(`[consultant:${ctx.tenant.id}] состояние диалога не записано`, e);
        await trySetSetting(
          ctx,
          KEYS.lastError,
          `${new Date().toISOString()} — состояние диалога не записано: ${e instanceof Error ? e.message : String(e)}`.slice(
            0,
            500,
          ),
        );
      }
    }
    return {
      reply,
      handoff,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        usd,
        cacheWriteTokens: u.cacheWrite,
        cacheReadTokens: u.cacheRead,
      },
      model,
      tools: toolsUsed,
      ...(out.attachments?.length ? { attachments: out.attachments } : {}),
      ...(out.rate !== undefined ? { rate: out.rate } : {}),
    };
  };
  try {
    if (pricelist) {
      const { runPricelistTurn } = await import("./pricelist/turn.server");
      const out = await runPricelistTurn(ctx, {
        text: incoming,
        state,
        model,
        callModel,
        story: opts.story,
        imageUrls: opts.imageUrls,
        images: opts.images,
      });
      toolsUsed.push(...out.tools);
      return await finish(out);
    }
    const tools = loaded ? [...CATALOG_TOOLS, REMEMBER_TOOL, ...TOOLS] : TOOLS;
    let contactAsked = Boolean(state.contact_asked);
    const phoneNow = phoneIn(incoming);
    const messages: Anthropic.MessageParam[] = buildConsultantMessages(
      state.recent ?? [],
      incoming,
    );
    const toolTexts: string[] = [];
    let stopped: "limited" | "late" | null = null;
    let reply = "";
    let handoff: Handoff | null = null;
    let response: Anthropic.Message | null = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1;
      const got = await callModel({
        model,
        max_tokens: 700,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral", ttl: CACHE_TTL } },
          { type: "text", text: `ДАННЫЕ ТЕКУЩЕГО ДИАЛОГА:\n${session}` },
        ],
        tools,
        // Последний раунд — без инструментов: модель отвечает тем, что уже нашла.
        ...(last && loaded ? { tool_choice: { type: "none" as const } } : {}),
        messages,
      });
      if (typeof got === "string") {
        stopped = got;
        break;
      }
      response = got;

      let text = "";
      let askContact = false;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          toolsUsed.push(block.name);
          const input = (block.input ?? {}) as Record<string, unknown>;
          if (loaded && CATALOG_TOOL_NAMES.has(block.name)) {
            const run = runCatalogTool(loaded, block.name, input);
            toolTexts.push(run.result);
            catalog.prices.push(...run.prices);
            results.push({ type: "tool_result", tool_use_id: block.id, content: run.result });
            continue;
          }
          if (loaded && block.name === REMEMBER_TOOL.name) {
            known = mergeProfile(known, input);
            results.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
            continue;
          }
          const str = (k: string) =>
            typeof input[k] === "string" && input[k].trim() ? (input[k] as string) : undefined;
          // Покупку без телефона менеджеру не отдаём: сначала контакт и способ получения (v1).
          if (
            loaded &&
            isPurchaseHandoff(block.name, input) &&
            !str("customer_contact") &&
            !known.phone &&
            !state.contact &&
            !phoneNow &&
            !contactAsked
          ) {
            contactAsked = true;
            askContact = true;
            toolsUsed.push("ask_contact");
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: ASK_CONTACT_RESULT,
            });
            continue;
          }
          const contact = str("customer_contact") ?? known.phone ?? phoneNow ?? undefined;
          const summary = (key: string) =>
            [
              str(key) ?? "",
              loaded && formatProfile(known) ? `Известно: ${formatProfile(known)}` : "",
            ]
              .filter(Boolean)
              .join("\n");
          if (block.name === "handoff_to_manager")
            handoff = {
              kind: "handoff",
              reason: str("reason") ?? "human_requested",
              customerName: str("customer_name") ?? known.name,
              customerContact: contact,
              summary: summary("summary"),
            };
          else if (block.name === "record_order_lead")
            handoff = {
              kind: "lead",
              reason: str("lead_type") ?? "order",
              customerName: str("customer_name") ?? known.name,
              customerContact: contact,
              summary: summary("details"),
            };
          results.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
        }
      }
      // Нужны данные каталога — ещё раунд с результатами; иначе ответ готов.
      // Текст раунда, который ушёл за данными («секунду, посмотрю») или за
      // контактом («передаю менеджеру»), покупателю не уходит.
      const needsData = response.content.some(
        (b) => b.type === "tool_use" && CATALOG_TOOL_NAMES.has(b.name),
      );
      if (text.trim() && !needsData && !askContact) reply = text;
      // Ещё раунд и тогда, когда нужно спросить контакт или модель только
      // запомнила сказанное и ничего не ответила.
      const more = needsData || askContact || !text.trim();
      if (last || !loaded || !more || response.stop_reason !== "tool_use" || handoff) break;
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: results });
    }

    // Лимит частоты или потолок времени до готового ответа — вопрос менеджеру, молча.
    if (!reply && !handoff && stopped) {
      await trySetSetting(
        ctx,
        KEYS.lastError,
        `${new Date().toISOString()} — ${stopped === "limited" ? "лимит частоты вызовов ИИ" : "не уложился в потолок времени"}; вопрос передан менеджеру`,
      );
      reply = "Передам ваш вопрос менеджеру — он ответит в ближайшее время.";
      handoff = {
        kind: "handoff",
        reason: "unknown_question",
        summary: `ИИ-консультант не ответил (${stopped === "limited" ? "лимит частоты" : "долго искал"}). Клиент написал: «${incoming.slice(0, 200)}»`,
      };
    }
    if (response?.stop_reason === "refusal") {
      reply = "Передам ваш вопрос менеджеру — он ответит в ближайшее время.";
      handoff = handoff ?? {
        kind: "handoff",
        reason: "unknown_question",
        summary: incoming.slice(0, 300),
      };
    }
    reply = cleanReply(reply);
    // Цена или доставка не из каталога и условий — покупателю не уходит, вопрос менеджеру.
    const facts = checkReplyFacts(
      reply,
      knownNumbers({
        prices: catalog.prices,
        texts: [system, session, incoming, ...history.map((h) => String(h.content)), ...toolTexts],
      }),
    );
    if (!facts.ok) {
      console.warn(`[consultant:${ctx.tenant.id}] ответ заменён: ${facts.reason}`);
      await trySetSetting(
        ctx,
        KEYS.lastError,
        `${new Date().toISOString()} — ответ консультанта не отправлен: ${facts.reason}; вопрос передан менеджеру`.slice(
          0,
          500,
        ),
      );
      reply = "Точную стоимость уточню у менеджера — он напишет вам в ближайшее время.";
      handoff = handoff ?? {
        kind: "handoff",
        reason: "unknown_question",
        summary: `Консультант назвал ${facts.reason}. Клиент написал: «${incoming.slice(0, 200)}»`,
      };
    }
    if (!reply && handoff)
      reply =
        handoff.kind === "lead"
          ? "Спасибо, всё записал и передал менеджеру — он свяжется с вами для подтверждения."
          : "Передаю диалог менеджеру — он ответит в ближайшее время.";
    if (!reply) reply = "Уточните, пожалуйста, что именно вас интересует — подскажу.";

    return await finish({
      reply,
      handoff,
      clearError: facts.ok,
      patch: loaded ? { profile: known, contact_asked: contactAsked || undefined } : {},
    });
  } catch (e) {
    // Бронь ИИ-баланса закрываем всегда: прошедшие раунды — по их цене, упавший
    // вызов клиент не оплачивает; раундов не было — бронь назад целиком.
    if (!settled) {
      const spent = costUsd();
      if (spent > 0) await aiSettle(ctx, aiHold, spent).catch(() => {});
      else await aiRelease(ctx, aiHold).catch(() => {});
    }
    const detail =
      e instanceof Anthropic.APIError
        ? `HTTP ${e.status ?? "?"}: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.error(`[consultant:${ctx.tenant.id}]`, detail);
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${detail}`.slice(0, 500),
    );
    // Бронь закрываем прошедшими раундами плюс одна бронь на упавший вызов:
    // Anthropic мог успеть его списать, а мы этого не узнаем.
    if (!settled) {
      const spent = costUsd();
      if (spent > 0)
        await recordUsage(
          ctx,
          spent,
          u.input_tokens + u.cacheWrite + u.cacheRead,
          u.output_tokens,
        ).catch(() => {});
      await updateSettingAtomic(ctx, KEYS.daily, (raw) =>
        settleRaw(raw, date, reserveUsd, spent + RESERVE_USD),
      ).catch(() => {});
    }
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
