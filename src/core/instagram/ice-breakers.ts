import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import type { DirectBotSettings } from "./direct-bot-settings";

/**
 * Быстрые вопросы Instagram (ice breakers): до четырёх подсказок, которые
 * покупатель видит, когда впервые открывает диалог с магазином. Нажатие
 * приходит постбэком `IB:<вид>` и ведёт на готовые команды Direct
 * (channels/zernio/shop.server). Настройка продавца, по умолчанию
 * выключена; тексты можно менять, набор подсказок — нет. Ставит и снимает
 * их channels/zernio/ice-breakers.server — только клиентам v2: v1 такие
 * payload не понимает.
 */
export type IceBreakerKind = "catalog" | "orders" | "pay" | "contact";
export const ICE_BREAKER_KINDS: readonly IceBreakerKind[] = ["catalog", "orders", "pay", "contact"];
export const ICE_BREAKERS_KEY = "instagram_ice_breakers";
/** Предел Zernio и Meta на текст подсказки. */
export const ICE_BREAKER_QUESTION_MAX = 80;
export const ICE_BREAKER_PREFIX = "IB:";

export type IceBreakerItem = { kind: IceBreakerKind; question: string; on: boolean };
export type IceBreakersConfig = { enabled: boolean; items: IceBreakerItem[] };

const DEFAULT_QUESTION: Record<IceBreakerKind, string> = {
  catalog: "Каталог",
  orders: "Мои заказы",
  pay: "Как оплатить",
  contact: "Связаться с продавцом",
};

export function defaultIceBreakers(): IceBreakersConfig {
  return {
    enabled: false,
    items: ICE_BREAKER_KINDS.map((kind) => ({ kind, question: DEFAULT_QUESTION[kind], on: true })),
  };
}

/** Одна строка, без лишних пробелов, не длиннее 80 знаков (суррогатную пару не режем). */
export function iceBreakerQuestion(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  let out = "";
  for (const ch of one) {
    if (out.length + ch.length > ICE_BREAKER_QUESTION_MAX) break;
    out += ch;
  }
  return out.trim();
}

export function parseIceBreakers(raw: string | null | undefined): IceBreakersConfig {
  const d = defaultIceBreakers();
  if (!raw) return d;
  let p: { enabled?: unknown; items?: unknown };
  try {
    p = JSON.parse(raw) as typeof p;
  } catch {
    return d;
  }
  if (!p || typeof p !== "object") return d;
  const given = new Map<string, { question?: unknown; on?: unknown }>();
  if (Array.isArray(p.items))
    for (const i of p.items as Array<Record<string, unknown>>)
      if (i && typeof i === "object" && typeof i.kind === "string") given.set(i.kind, i);
  return {
    enabled: p.enabled === true,
    items: d.items.map((item) => {
      const g = given.get(item.kind);
      const q = typeof g?.question === "string" ? iceBreakerQuestion(g.question) : "";
      return { kind: item.kind, question: q || item.question, on: g?.on !== false };
    }),
  };
}

export async function loadIceBreakers(ctx: TenantContext): Promise<IceBreakersConfig> {
  return parseIceBreakers(await getSetting(ctx, ICE_BREAKERS_KEY));
}

export async function saveIceBreakers(ctx: TenantContext, cfg: IceBreakersConfig): Promise<void> {
  await setSetting(ctx, ICE_BREAKERS_KEY, JSON.stringify(parseIceBreakers(JSON.stringify(cfg))));
}

/**
 * Что поставить в Instagram: пусто, если настройка выключена, магазина в
 * Direct нет или автоответчик молчит. Подсказка на выключенную продавцом
 * часть магазина (каталог, оформление) не ставится — она бы не ответила.
 */
export function iceBreakersFor(
  cfg: IceBreakersConfig,
  bot: Pick<DirectBotSettings, "enabled" | "features">,
  modules: { instagram?: boolean; dm_shop?: boolean },
): Array<{ question: string; payload: string }> {
  if (!cfg.enabled || !modules.instagram || !modules.dm_shop || !bot.enabled) return [];
  return cfg.items
    .filter((i) => i.on && i.question)
    .filter((i) => (i.kind === "catalog" ? bot.features.catalog : true))
    .filter((i) => (i.kind === "pay" ? bot.features.checkout : true))
    .map((i) => ({ question: i.question, payload: `${ICE_BREAKER_PREFIX}${i.kind}` }));
}

/** Постбэк подсказки → её вид; чужой постбэк — null. */
export function iceBreakerKind(payload: string | null | undefined): IceBreakerKind | null {
  if (!payload?.startsWith(ICE_BREAKER_PREFIX)) return null;
  const k = payload.slice(ICE_BREAKER_PREFIX.length);
  return (ICE_BREAKER_KINDS as readonly string[]).includes(k) ? (k as IceBreakerKind) : null;
}

/** Сколько ждём вопроса после «Связаться с продавцом». */
export const CONTACT_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * Покупатель нажал «Связаться с продавцом» и ещё не написал вопрос: метка
 * direct.contact_requested_at в state. Следующий свободный вопрос уходит
 * продавцу (обращение или уведомление), а не ИИ-консультанту.
 */
export function contactRequested(state: { direct?: unknown }, now = Date.now()): boolean {
  const d = state.direct;
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const at = Date.parse(String((d as Record<string, unknown>).contact_requested_at ?? ""));
  return Number.isFinite(at) && now - at >= 0 && now - at < CONTACT_WAIT_MS;
}
