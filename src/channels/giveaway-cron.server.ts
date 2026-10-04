import type { Tenant } from "@/core/tenant/types";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import { servedByV2 } from "@/core/tenant/directory";
import { closeGiveaway, listGiveaways, type Giveaway } from "@/core/giveaways/giveaway";
import { drawWinners } from "@/core/giveaways/draw";
import { NOTICE_EVENT } from "@/core/giveaways/notify";
import { getCustomer } from "@/core/customers/customers";
import type { ZernioTransport } from "@/channels/zernio/api.server";
import { adminTelegramApi, notifyAdminsHtml } from "@/channels/telegram/notify";
import { membership } from "@/channels/telegram/giveaway";
import { notifyGiveawayWinners } from "@/channels/giveaway-notify.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Крон `giveaways` (раз в 5 минут): по сроку закрывает приём, выбирает
 * победителей (core/giveaways/draw), шлёт им сообщения (К5) и один раз
 * сообщает продавцу итог. Только клиенты v2. Каждый шаг повторяем: статус
 * пишется условно (два крона — один выбор), сообщение и отчёт продавцу —
 * по отметке до отправки. Не успели за бюджет — `left`, следующий прогон
 * продолжит с того же места: что сделано, в учёте уже есть.
 */
export const GIVEAWAY_CRON_BUDGET_MS = 80_000;
/** Сообщения победителям досылаем в течение недели после выбора, дальше розыгрыш не трогаем. */
export const NOTICE_WEEKS_MS = 7 * 86_400_000;

export type GiveawayCronResult =
  | { skipped: string }
  | { closed: number; drawn: number; notified: number; manual: number; left: number };

const REPORT: Record<Locale, { done: string; none: string; winners: string; more: string }> = {
  ru: {
    done: "🎁 Розыгрыш «{title}» завершён. Участвовало: {entered}, допущено: {eligible}.",
    none: "Победителей нет: никто не участвовал или никто не прошёл условия.",
    winners: "Победители:",
    more: "Подробности — «Рассылки» → «Розыгрыши».",
  },
  kk: {
    done: "🎁 «{title}» ұтыс ойыны аяқталды. Қатысқаны: {entered}, жіберілгені: {eligible}.",
    none: "Жеңімпаздар жоқ: ешкім қатыспады немесе ешкім шарттан өтпеді.",
    winners: "Жеңімпаздар:",
    more: "Толығырақ — «Тарату» → «Ұтыс ойындары».",
  },
  en: {
    done: "🎁 Giveaway “{title}” has finished. Entered: {entered}, eligible: {eligible}.",
    none: "There are no winners: nobody entered or nobody met the conditions.",
    winners: "Winners:",
    more: "Details: Broadcasts → Giveaways.",
  },
  uz: {
    done: "🎁 «{title}» o'yini yakunlandi. Qatnashganlar: {entered}, ruxsat etilganlar: {eligible}.",
    none: "G'oliblar yo'q: hech kim qatnashmadi yoki hech kim shartlarga mos kelmadi.",
    winners: "G'oliblar:",
    more: "Batafsil: «Xabarlar» → «O'yinlar».",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const reportEventId = (giveawayId: string) => `giveaway:${giveawayId}:report`;

/** Итог продавцу: ставим отметку до отправки, пишет только выигравший вставку. */
async function reportToSeller(ctx: TenantContext, g: Giveaway): Promise<boolean> {
  if (!g.result) return false;
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: reportEventId(g.id),
    event_type: NOTICE_EVENT,
    status: "sent",
    payload: { giveaway_id: g.id, kind: "report", at: g.result.drawnAt } as Json,
  });
  if (error) {
    if (error.code === "23505") return false;
    throw serverFailure(`Розыгрыш: отметка итога не записана: ${error.message}`);
  }
  const copy = REPORT[ctx.tenant.settings.default_locale ?? "ru"];
  const names: string[] = [];
  for (const w of g.result.winners) {
    const c = await getCustomer(ctx, w.userKey);
    names.push(`• ${c?.username ? `@${esc(c.username)}` : esc(c?.firstName ?? w.userKey)}`);
  }
  const head = copy.done
    .replace("{title}", esc(g.title))
    .replace("{entered}", String(g.result.entered))
    .replace("{eligible}", String(g.result.eligible));
  const body = names.length ? `${copy.winners}\n${names.join("\n")}` : copy.none;
  try {
    await notifyAdminsHtml(ctx, `${head}\n${body}\n${copy.more}`, { kind: "system" });
  } catch (e) {
    console.error(`[giveaways:${ctx.tenant.id}] итог продавцу`, e);
  }
  return true;
}

export async function runGiveawaysFor(
  tenant: Tenant,
  opts: {
    now?: () => number;
    budgetMs?: number;
    transport?: ZernioTransport;
  } = {},
): Promise<GiveawayCronResult> {
  if (!servedByV2(tenant)) return { skipped: "not v2" };
  if (!tenant.modules.giveaways) return { skipped: "module off" };
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? GIVEAWAY_CRON_BUDGET_MS;
  const ctx = tenantContext(tenant);
  const r = { closed: 0, drawn: 0, notified: 0, manual: 0, left: 0 };
  const tg = adminTelegramApi(ctx);
  const isMember = tg ? membership(tg) : null;
  for (const listed of await listGiveaways(ctx)) {
    if (clock() - started >= budget) {
      r.left++;
      continue;
    }
    try {
      let g = listed;
      const due = Date.parse(g.endsAt) <= clock();
      // Приём закрывается по сроку; повтор и гонка безвредны (closeGiveaway идемпотентен).
      if (g.status === "open" && due) {
        g = await closeGiveaway(ctx, g.id, new Date(clock()));
        r.closed++;
      }
      // Вручную закрытый раньше срока ждёт срока: до него продавец может выбрать сам кнопкой.
      if (g.status === "closed" && due) {
        const out = await drawWinners(ctx, g.id, isMember, new Date(clock()));
        g = out.giveaway;
        if (out.fresh) r.drawn++;
      }
      if (g.status !== "drawn" || !g.result) continue;
      await reportToSeller(ctx, g);
      if (clock() - Date.parse(g.result.drawnAt) > NOTICE_WEEKS_MS) continue;
      const n = await notifyGiveawayWinners(ctx, g.id, {
        transport: opts.transport,
        now: clock,
        budgetMs: Math.max(1_000, budget - (clock() - started)),
      });
      r.notified += n.sent + n.consolationSent;
      r.manual += n.manual;
      r.left += n.left;
    } catch (e) {
      // Один розыгрыш не должен ронять остальные: сбой — в журнал, следующий прогон повторит.
      console.error(`[giveaways:${tenant.id}] ${listed.id}`, e);
      r.left++;
    }
  }
  return r;
}
