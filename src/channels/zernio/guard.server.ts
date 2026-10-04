import type { TenantContext } from "@/core/tenant/resolve.server";
import { readZernioGuard, swapZernioGuard, tenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { noticeLocale } from "@/core/helpdesk/seller-texts";
import {
  detectProblems,
  downText,
  planTransitions,
  reconnectLabel,
  registerFailure,
  upText,
  type GuardPlatform,
  type GuardProblem,
  type Transition,
} from "./guard";

/**
 * Страж каналов: продавец узнаёт от бота, а не от покупателей, что Instagram
 * или WhatsApp не работает, и что он снова ожил. Три источника: слетевший
 * токен (снимок аккаунтов, событие account.disconnected), отключённый вебхук
 * Zernio и серия сбоев отправки (message.failed). Переход пишется условно
 * (swapZernioGuard), сообщение шлёт тот, чья запись выиграла: два крона или
 * крон и событие в один момент дают одно сообщение. Крон health, этап
 * channelGuard, обходит только клиентов v2.
 */
export type GuardResult = {
  tenants: number;
  down: number;
  up: number;
  errors: Record<string, string>;
};

async function send(ctx: TenantContext, platform: GuardPlatform, t: Transition): Promise<boolean> {
  const locale = await noticeLocale(ctx);
  const tz = ctx.timezone;
  const html =
    t.kind === "down" && t.to
      ? downText(locale, platform, t.to, tz)
      : t.kind === "up"
        ? upText(locale, platform)
        : null;
  if (!html) return false;
  const sent = await notifyAdminsHtml(ctx, html, {
    kind: "account",
    ...(t.kind === "down"
      ? {
          replyMarkup: {
            inline_keyboard: [
              [{ text: reconnectLabel(locale), url: `${ctx.appUrl}/admin/instagram` }],
            ],
          },
        }
      : {}),
  });
  return sent > 0;
}

/** Записать переход; отправляет сообщение только выигравший запись. */
async function commit(ctx: TenantContext, t: Transition): Promise<boolean> {
  const won = await swapZernioGuard(ctx.tenant.id, t.platform, t.from, t.to);
  if (!won) return false;
  if (t.kind !== "quiet") {
    try {
      await send(ctx, t.platform, t);
    } catch (e) {
      // Переход записан: повтор сообщения хуже тишины, продавец увидит красный канал в админке.
      console.error(`[channel-guard:${ctx.tenant.id}] сообщение продавцу не ушло:`, e);
    }
  }
  return true;
}

/** Событие «токен слетел» (account.disconnected и сверка): канал лежит по причине `reason`. */
export async function markChannelDown(
  ctx: TenantContext,
  platform: GuardPlatform,
  reason: GuardProblem = "token",
): Promise<{ notified: boolean }> {
  const current = await readZernioGuard(ctx.tenant.id);
  const t = planTransitions(current, { [platform]: reason }, Date.now()).find(
    (x) => x.platform === platform,
  );
  if (!t) return { notified: false };
  const won = await commit(ctx, t);
  return { notified: won && t.kind === "down" };
}

/** Сбой отправки (message.failed): после FAIL_THRESHOLD подряд канал считается лежащим. */
export async function recordSendFailure(
  ctx: TenantContext,
  platform: GuardPlatform,
): Promise<{ notified: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = (await readZernioGuard(ctx.tenant.id))[platform] ?? null;
    const r = registerFailure(cur, Date.now());
    if (!r) return { notified: false };
    const won = await swapZernioGuard(ctx.tenant.id, platform, cur, r.next);
    if (!won) continue;
    if (r.becameDown) {
      try {
        await send(ctx, platform, { platform, kind: "down", from: cur, to: r.next });
      } catch (e) {
        console.error(`[channel-guard:${ctx.tenant.id}] сообщение продавцу не ушло:`, e);
      }
    }
    return { notified: r.becameDown };
  }
  return { notified: false };
}

/**
 * Этап крона health: сверка записей стража со снимком аккаунтов и вебхуком.
 * `webhookOk` — одно чтение на прогон (вебхук общий); null — не проверен.
 */
export async function runChannelGuardFor(
  tenants: readonly Tenant[],
  webhookOk: boolean | null,
): Promise<GuardResult> {
  const r: GuardResult = { tenants: 0, down: 0, up: 0, errors: {} };
  for (const t of tenants) {
    if (!servedByV2(t) || t.archived) continue;
    const accounts = t.settings.zernio?.accounts ?? [];
    if (!accounts.length && !t.settings.zernio?.guard) continue;
    r.tenants++;
    try {
      const ctx = tenantContext(t);
      const current = await readZernioGuard(t.id);
      for (const tr of planTransitions(current, detectProblems(accounts, webhookOk), Date.now())) {
        if (!(await commit(ctx, tr))) continue;
        if (tr.kind === "down") r.down++;
        if (tr.kind === "up") r.up++;
      }
    } catch (e) {
      r.errors[t.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return r;
}
