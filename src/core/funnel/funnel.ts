import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { customerFromRow, isBlocked, setState, type Customer } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { daytime } from "@/core/winback/winback";

/**
 * Автоворонка (модуль funnel): серия сообщений новому покупателю по
 * расписанию от первого контакта с ботом — прогрев, полезное, предложение.
 * Шаг — `{afterHours, text, catalogButton}`; прогресс — в
 * `bot_users.state.funnel = {step}` (номер последнего отправленного).
 * Сделавшему заказ серия, по желанию продавца, прекращается. Отправка —
 * кроном раз в час, только днём по поясу магазина; опоздавший шаг уходит
 * один (без очереди из нескольких сразу).
 */
export type FunnelStep = { afterHours: number; text: string; catalogButton: boolean };
export type FunnelConfig = { enabled: boolean; stopOnOrder: boolean; steps: FunnelStep[] };

export const FUNNEL_KEY = "funnel";
export const FUNNEL_MAX_STEPS = 10;
export const FUNNEL_BATCH = 50;
/** Контакты старше этого в серию не берём — воронка для новых. */
export const FUNNEL_WINDOW_DAYS = 45;

export function parseFunnel(raw: string | null | undefined): FunnelConfig {
  const d: FunnelConfig = { enabled: false, stopOnOrder: true, steps: [] };
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<FunnelConfig>;
    const steps = Array.isArray(p.steps)
      ? p.steps
          .map((s) => ({
            afterHours: Math.round(Number(s?.afterHours)),
            text: typeof s?.text === "string" ? s.text.trim().slice(0, 2000) : "",
            catalogButton: s?.catalogButton === true,
          }))
          .filter((s) => s.text && s.afterHours >= 1 && s.afterHours <= FUNNEL_WINDOW_DAYS * 24)
          .sort((a, b) => a.afterHours - b.afterHours)
          .slice(0, FUNNEL_MAX_STEPS)
      : [];
    return { enabled: p.enabled === true, stopOnOrder: p.stopOnOrder !== false, steps };
  } catch {
    return d;
  }
}

/** Индекс шага, который пора отправить (0-базовый), или null. Берём самый поздний наступивший. */
export function funnelDue(
  cfg: FunnelConfig,
  createdAt: string,
  sentStep: number,
  now: Date,
): number | null {
  const hours = (now.getTime() - Date.parse(createdAt)) / 3600_000;
  let due: number | null = null;
  cfg.steps.forEach((s, i) => {
    if (i + 1 > sentStep && hours >= s.afterHours) due = i;
  });
  return due;
}

export function fillFunnelText(text: string, name: string | null): string {
  return text.replaceAll("{name}", name?.trim() || "Здравствуйте");
}

export async function loadFunnel(ctx: TenantContext): Promise<FunnelConfig> {
  return parseFunnel(await getSetting(ctx, FUNNEL_KEY));
}

export async function saveFunnel(ctx: TenantContext, cfg: FunnelConfig): Promise<void> {
  await setSetting(ctx, FUNNEL_KEY, JSON.stringify(cfg));
}

export type FunnelSender = (c: Customer, text: string, catalogButton: boolean) => Promise<boolean>;

export async function runFunnel(
  ctx: TenantContext,
  send: FunnelSender,
  now = new Date(),
): Promise<{ checked: number; sent: number; failed: number; skipped?: string }> {
  const r = { checked: 0, sent: 0, failed: 0 };
  if (!ctx.tenant.modules.funnel) return { ...r, skipped: "module off" };
  const cfg = await loadFunnel(ctx);
  if (!cfg.enabled || !cfg.steps.length) return { ...r, skipped: "disabled" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const since = new Date(now.getTime() - FUNNEL_WINDOW_DAYS * 86_400_000).toISOString();
  const firstAfter = new Date(now.getTime() - cfg.steps[0]!.afterHours * 3600_000).toISOString();
  const { data } = await ctx.db
    .from("bot_users")
    .select("*")
    .gte("created_at", since)
    .lte("created_at", firstAfter)
    .order("created_at", { ascending: true })
    .limit(1000);
  const rows = data ?? [];
  let ordered = new Set<number>();
  if (cfg.stopOnOrder && rows.length) {
    const { data: orders } = await ctx.db
      .from("orders")
      .select("telegram_id")
      .in(
        "telegram_id",
        rows.map((u) => u.telegram_id),
      );
    ordered = new Set((orders ?? []).map((o) => Number(o.telegram_id)));
  }
  for (const row of rows) {
    if (r.sent + r.failed >= FUNNEL_BATCH) break;
    const c = customerFromRow(row);
    const mem = c.state.funnel as { step?: number; stopped?: boolean } | undefined;
    if (mem?.stopped) continue;
    r.checked++;
    if (ordered.has(c.telegramId)) {
      await setState(ctx, c, { ...c.state, funnel: { ...(mem ?? {}), stopped: true } as Json });
      continue;
    }
    const due = funnelDue(cfg, row.created_at, mem?.step ?? 0, now);
    if (due == null || (await isBlocked(ctx, c.telegramId))) continue;
    const step = cfg.steps[due]!;
    const ok = await send(c, fillFunnelText(step.text, c.firstName), step.catalogButton).catch(
      () => false,
    );
    if (ok) r.sent++;
    else r.failed++;
    await setState(ctx, c, {
      ...c.state,
      funnel: { step: due + 1, at: now.toISOString() } as unknown as Json,
    });
  }
  return r;
}
