/**
 * Таблица здоровья клиентов у оператора: состояние каналов, тариф, «проблемный»,
 * «оплата скоро». Чистые функции над `ClientView`; чтение базы — в `operator.server.ts`.
 */
import { CUSTOM_PLAN, TIER_TITLES, type PlanTier } from "@/core/plans/registry";

/** Сколько дней до конца подписки считается «оплата скоро» (как «заканчивается в 14 дней» в О9). */
export const PAYMENT_SOON_DAYS = 14;

export type ChannelTone = "ok" | "warn" | "danger" | "neutral";

export type ChannelState = {
  key: "telegram" | "instagram" | "whatsapp";
  label: string;
  tone: ChannelTone;
  /** Что именно не так — для подсказки; пусто, если всё в порядке. */
  hint: string;
};

/** Поля клиента, которые читают функции ниже (подмножество `ClientView`). */
export type HealthClient = {
  servedBy: "v1" | "v2" | null;
  plan: string | null;
  telegram: { connected: boolean; webhookOk: boolean };
  zernio: {
    accounts: Array<{ platform: string; expired: boolean }>;
    /** Страж каналов (channels/zernio/guard): канал лежит с … по причине …; нет — всё в порядке. */
    down?: Array<{ platform: string; hint: string }>;
  };
  health: { ok: boolean; error: string | null } | null;
  subscription: { state: string; daysLeft: number | null };
};

export function planLabel(plan: string | null): string {
  if (!plan) return "—";
  if (plan === CUSTOM_PLAN) return "Индивидуальный";
  const tier = plan.split(".")[1] as PlanTier | undefined;
  return (tier && TIER_TITLES[tier]) ?? plan;
}

/**
 * Каналы с цветом состояния. Telegram: нет токена — серый; клиент v2 с отказом вебхука или
 * сбоем последней проверки — красный; у клиента v1 вебхук держит v1, его состояние мы не
 * проверяем, поэтому серый «на v1», а не зелёный. Instagram/WhatsApp: аккаунт с истёкшей
 * авторизацией — красный.
 */
export function channelStates(c: HealthClient): ChannelState[] {
  const out: ChannelState[] = [];
  if (!c.telegram.connected) {
    out.push({ key: "telegram", label: "Telegram", tone: "neutral", hint: "не подключён" });
  } else if (c.servedBy !== "v2") {
    out.push({ key: "telegram", label: "Telegram", tone: "neutral", hint: "обслуживает v1" });
  } else if (!c.telegram.webhookOk) {
    out.push({ key: "telegram", label: "Telegram", tone: "danger", hint: "вебхук не привязан" });
  } else if (c.health && !c.health.ok) {
    out.push({
      key: "telegram",
      label: "Telegram",
      tone: "danger",
      hint: c.health.error ?? "сбой последней проверки",
    });
  } else if (!c.health) {
    out.push({ key: "telegram", label: "Telegram", tone: "neutral", hint: "нет данных проверки" });
  } else {
    out.push({ key: "telegram", label: "Telegram", tone: "ok", hint: "" });
  }
  for (const [platform, key, label] of [
    ["instagram", "instagram", "Instagram"],
    ["whatsapp", "whatsapp", "WhatsApp"],
  ] as const) {
    const accs = c.zernio.accounts.filter((a) => a.platform === platform);
    const down = c.zernio.down?.find((d) => d.platform === platform);
    if (accs.length === 0 && !down) continue;
    const expired = accs.some((a) => a.expired);
    out.push({
      key,
      label,
      tone: expired || down ? "danger" : "ok",
      hint: down?.hint ?? (expired ? "авторизация аккаунта истекла" : ""),
    });
  }
  return out;
}

/** «Последняя ошибка»: что сейчас красное у клиента (первая причина) или null. */
export function lastError(c: HealthClient): string | null {
  const bad = channelStates(c).find((s) => s.tone === "danger");
  return bad ? `${bad.label}: ${bad.hint}` : null;
}

/** Проблемный: красный канал или подписка просрочена. */
export function isProblem(c: HealthClient): boolean {
  if (channelStates(c).some((s) => s.tone === "danger")) return true;
  return c.subscription.state === "overdue" || c.subscription.state === "grace_over";
}

/** Оплата скоро: подписка заканчивается в ближайшие 14 дней (включая сегодня). */
export function isPaymentSoon(c: HealthClient): boolean {
  const d = c.subscription.daysLeft;
  return c.subscription.state === "expiring" || (d !== null && d >= 0 && d <= PAYMENT_SOON_DAYS);
}

export type OpenInvoice = { bot_id: string; amount: number | string };

/** Долг клиента: сумма выставленных, но не оплаченных счетов за подписку. */
export function debtByClient(
  invoices: OpenInvoice[],
): Map<string, { amount: number; count: number }> {
  const out = new Map<string, { amount: number; count: number }>();
  for (const i of invoices) {
    const cur = out.get(i.bot_id) ?? { amount: 0, count: 0 };
    cur.amount += Number(i.amount);
    cur.count += 1;
    out.set(i.bot_id, cur);
  }
  return out;
}
