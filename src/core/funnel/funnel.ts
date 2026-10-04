import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  claimStateSection,
  customerFromRow,
  isBlocked,
  type Customer,
} from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import { daytime } from "@/core/winback/winback";
import { eachPage, pageAll } from "@/core/db/page";

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

/** Кто из этих покупателей уже заказывал: id кусками, чтобы запрос не упёрся в 1000 строк. */
async function customersWithOrders(
  ctx: TenantContext,
  rows: ReadonlyArray<{ telegram_id: number }>,
): Promise<Set<number>> {
  const out = new Set<number>();
  const ids = [...new Set(rows.map((u) => u.telegram_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    // Одного заказа на покупателя хватает; заказов у 200 покупателей бывает больше 1000.
    const got = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("telegram_id")
          .in("telegram_id", chunk)
          .order("id")
          .range(from, to),
      "автоворонка: заказы",
    );
    for (const o of got) out.add(Number(o.telegram_id));
  }
  return out;
}

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
  const cap = await loadMarketingCap(ctx);
  const since = new Date(now.getTime() - FUNNEL_WINDOW_DAYS * 86_400_000).toISOString();
  const firstAfter = new Date(now.getTime() - cfg.steps[0]!.afterHours * 3600_000).toISOString();
  // Постранично: в окне 45 дней у крупного магазина больше 1000 новых
  // покупателей, а PostgREST молча отдаёт только первую тысячу.
  await eachPage(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("*")
        .gte("created_at", since)
        .lte("created_at", firstAfter)
        .order("created_at", { ascending: true })
        .order("user_key", { ascending: true })
        .range(from, to),
    "автоворонка: покупатели",
    async (rows) => {
      const ordered = cfg.stopOnOrder ? await customersWithOrders(ctx, rows) : new Set<number>();
      for (const row of rows) {
        if (r.sent + r.failed >= FUNNEL_BATCH) return false;
        // Отписавшийся от рассылок не получает и этих сообщений (core/customers/opt-out).
        if (row.opt_out) continue;
        const c = customerFromRow(row);
        const mem = c.state.funnel as { step?: number; stopped?: boolean } | undefined;
        if (mem?.stopped) continue;
        r.checked++;
        if (ordered.has(c.telegramId)) {
          // Раздел funnel — условной записью по его rev: остальной state (диалог бота, v1) не затираем.
          await claimStateSection(ctx, c, "funnel", (cur) => ({ ...cur, stopped: true }));
          continue;
        }
        const due = funnelDue(cfg, row.created_at, mem?.step ?? 0, now);
        if (due == null || (await isBlocked(ctx, c.telegramId))) continue;
        const step = cfg.steps[due]!;
        // Потолок маркетинговых сообщений за сутки (core/marketing/cap).
        const marked = await claimMarketing(ctx, c.userKey, row.state, cap, now);
        if (!marked) continue;
        // Шаг воронки отмечаем ДО отправки, условной записью по rev раздела
        // funnel: из двух кронов, дошедших до покупателя в одно время, пишет
        // первый, второй видит отметку и уступает (при потолке «0» claimMarketing
        // замка не даёт). Шаг остаётся и при неудачной отправке, как и раньше;
        // остальной state не затираем.
        const claimed = await claimStateSection(ctx, c, "funnel", (cur) =>
          cur.stopped === true || Number(cur.step ?? 0) > due
            ? null
            : { step: due + 1, at: now.toISOString() },
        );
        if (!claimed) continue;
        const ok = await send(c, fillFunnelText(step.text, c.firstName), step.catalogButton).catch(
          () => false,
        );
        if (ok) r.sent++;
        else r.failed++;
      }
      return r.sent + r.failed < FUNNEL_BATCH;
    },
  );
  return r;
}
