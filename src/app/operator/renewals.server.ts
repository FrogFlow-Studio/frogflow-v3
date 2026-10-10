import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { inChunks } from "@/lib/in-chunks";
import { reportError } from "@/lib/errors";
import { updateSettingAtomic, getSetting } from "@/core/settings/settings";
import { tenantContext, tenantDirectory } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { adminLocale } from "@/app/admin/locale.server";
import { todayInTz } from "@/core/fulfillment/pure";
import { daysBetween, trialState } from "@/core/plans/trial";
import { mayHaveArrived } from "@/core/notify/deliver";
import { notifyOwner } from "./operator.server";
import {
  RENEWAL_KEY,
  addMark,
  dropMark,
  dueRenewalStage,
  marksFor,
  renewalPrice,
  renewalSummary,
  type RenewalRow,
  type RenewalStage,
} from "./renewals";

/** true — дошло; false — точно не дошло; "unknown" — могло дойти (обрыв, тайм-аут). */
export type RenewalNotify = (botId: string, text: string) => Promise<boolean | "unknown">;
export type RenewalMail = (
  to: string,
  subject: string,
  text: string,
) => Promise<"sent" | "failed" | "unknown">;

const MAIL_TIMEOUT_MS = 15_000;
const RENEWALS_BUDGET_MS = 45_000;

const defaultNotify: RenewalNotify = async (botId, text) => {
  try {
    const r = await notifyOwner(botId, text);
    if (r.delivered.length > 0) return true;
    return r.failed.some((f) => mayHaveArrived(f.reason)) ? "unknown" : false;
  } catch {
    // Бросило посреди отправки: неизвестно, ушло ли — не повторяем.
    return "unknown";
  }
};

/** Письмо: тайм-аут и обрыв — «неизвестно» (могло дойти), SMTP не настроен — «не ушло». */
const defaultMail: RenewalMail = async (to, subject, text) => {
  const { smtpMailer, isMailConfigured } = await import("@/core/mail/mail.server");
  if (!isMailConfigured()) return "failed";
  const timeout = new Promise<"unknown">((resolve) => {
    const id = setTimeout(() => resolve("unknown"), MAIL_TIMEOUT_MS);
    id.unref?.();
  });
  const send = smtpMailer({ to, subject, text, html: escapeHtml(text).replace(/\n/g, "<br>") })
    .then((r) => (r.ok ? ("sent" as const) : ("unknown" as const)))
    .catch(() => "unknown" as const);
  return Promise.race([send, timeout]);
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type RenewalDeps = {
  notify: RenewalNotify;
  mail: RenewalMail;
  /** Ссылка Kaspi Pay платформы или null. */
  payLink: () => Promise<string | null>;
  /** Почта продавца для системных писем или null (не задана / выключена им). */
  sellerEmail: (ctx: TenantContext) => Promise<string | null>;
};

const realDeps = (): RenewalDeps => ({
  notify: defaultNotify,
  mail: defaultMail,
  payLink: async () => {
    const { getKaspiPayLink } = await import("./billing.server");
    const { normalizeKaspiLink } = await import("@/core/billing/pay/kaspi-link");
    return normalizeKaspiLink(await getKaspiPayLink()) || null;
  },
  sellerEmail: async (ctx) => {
    const { loadNotifyPrefs } = await import("@/core/notify/prefs");
    const prefs = await loadNotifyPrefs(ctx);
    return prefs.email && prefs.kinds.system.email ? prefs.email : null;
  },
});

/** Текст напоминания: срок, цена, как оплатить, «ничего не списываем». */
export function renewalText(
  t: AdminT,
  stage: RenewalStage,
  p: {
    dateLabel: string;
    price: { amount: number; period: import("@/core/tenant/types").BillingPeriod } | null;
    payUrl: string | null;
  },
): string {
  const lines = [t(`renew.${stage}`, { date: p.dateLabel })];
  if (p.price)
    lines.push(
      t("renew.price", {
        amount: p.price.amount.toLocaleString("ru").replace(/\s/g, " "),
        period: t(`renew.period.${p.price.period}`),
      }),
    );
  lines.push(p.payUrl ? t("renew.payLink", { url: p.payUrl }) : t("renew.payAdmin"));
  lines.push(t("renew.note"));
  return lines.join("\n");
}

type Ctx = ReturnType<typeof tenantContext>;
const mark = (ctx: Ctx, expires: string, m: string) =>
  updateSettingAtomic(ctx, RENEWAL_KEY, (raw) => addMark(raw, expires, m));
const unmark = (ctx: Ctx, expires: string, m: string) =>
  updateSettingAtomic(ctx, RENEWAL_KEY, (raw) => dropMark(raw, expires, m));

export type RenewalOutcome = { stage: RenewalStage; telegram: string; email: string };

/**
 * Крон подписок, раз в сутки: платящему клиенту v2 — напоминание за 7, 3 и 1
 * день до конца и в день окончания, в Telegram владельца и (если он включил
 * системную почту) на почту, на его языке, с ценой продления и способом
 * оплаты. Только уведомление: ничего не списываем и не выставляем. Пробный
 * период ведёт свой обход (trial-remind). Метка стадии ставится условной
 * записью до отправки; точно не дошедшее в Telegram метку снимает, могло
 * дойти — не повторяем. Оплатил — срок ушёл вперёд, новых стадий нет.
 */
export async function runRenewals(
  tenants: readonly Tenant[],
  now = new Date(),
  deps: RenewalDeps = realDeps(),
): Promise<Record<string, RenewalOutcome | "failed">> {
  const out: Record<string, RenewalOutcome | "failed"> = {};
  const candidates = tenants.filter((t) => servedByV2(t) && !t.archived && t.status === "active");
  if (!candidates.length) return out;
  const rows = await inChunks(
    candidates.map((t) => t.id),
    (chunk) => serviceDb().from("bots").select("id, subscription_expires_at").in("id", chunk),
    "[renewals] сроки подписок не прочитаны",
  );
  const expires = new Map(rows.map((r) => [r.id, r.subscription_expires_at]));
  // Общий бюджет этапа: крон подписок делает и другую работу. Не успевшие получат
  // свою стадию следующим запуском (стадия — окно дней, а не точная дата).
  const deadline = Date.now() + RENEWALS_BUDGET_MS;
  for (const t of candidates) {
    if (Date.now() > deadline) break;
    try {
      const exp = expires.get(t.id)?.slice(0, 10);
      if (!exp) continue;
      const ctx = tenantContext(t);
      const today = todayInTz(ctx.timezone, now);
      if (trialState(t.settings.billing, exp, today)) continue;
      const sent = marksFor((await getSetting(ctx, RENEWAL_KEY)) ?? null, exp);
      const stage = dueRenewalStage(daysBetween(today, exp), sent);
      if (!stage) continue;
      const claimed = await mark(ctx, exp, stage);
      if (claimed === "failed") {
        out[t.id] = "failed";
        continue;
      }
      if (claimed !== "written") continue;
      const locale = await adminLocale(ctx);
      const text = renewalText(adminT(locale), stage, {
        dateLabel: new Date(`${exp}T12:00:00Z`).toLocaleDateString(intlLocale(locale), {
          day: "2-digit",
          month: "2-digit",
          timeZone: "UTC",
        }),
        price: renewalPrice(t),
        payUrl: await deps.payLink(),
      });
      const r = await deps.notify(t.id, text);
      if (r === false) await unmark(ctx, exp, stage);
      const outcome: RenewalOutcome = {
        stage,
        telegram: r === true ? "sent" : r === "unknown" ? "unknown" : "failed",
        email: "none",
      };
      const to = await deps.sellerEmail(ctx);
      // Почта — своя метка и не снимается: ответ SMTP часто неоднозначен, второе письмо хуже пропущенного.
      if (to && (await mark(ctx, exp, `${stage}m`)) === "written")
        outcome.email = await deps.mail(to, text.split("\n")[0]!.slice(0, 120), text);
      out[t.id] = outcome;
    } catch (e) {
      await reportError(e, { where: "cron:renewals", botId: t.id });
      out[t.id] = "failed";
    }
  }
  return out;
}

export type RenewalsOverview = ReturnType<typeof renewalSummary> & { withinDays: number };

/**
 * Для оператора: кто заканчивается в ближайшие N дней и сколько ожидается.
 * Читает и клиентов v1 (только чтение, с пометкой платформы): это знание
 * оператора, воронка их не трогает.
 */
export async function renewalsOverview(
  withinDays = 14,
  now = new Date(),
): Promise<RenewalsOverview> {
  const tenants = (await tenantDirectory(true)).filter(
    (t) => !t.archived && t.status !== "suspended",
  );
  const rows = await inChunks(
    tenants.map((t) => t.id),
    (chunk) => serviceDb().from("bots").select("id, subscription_expires_at").in("id", chunk),
    "[renewals] сроки подписок не прочитаны",
  );
  const expires = new Map(rows.map((r) => [r.id, r.subscription_expires_at]));
  const today = todayInTz(env().APP_TIMEZONE, now);
  const list: RenewalRow[] = [];
  for (const t of tenants) {
    const exp = expires.get(t.id)?.slice(0, 10);
    if (!exp) continue;
    list.push({
      botId: t.id,
      name: t.name,
      servedBy: t.settings.served_by ?? null,
      expires: exp,
      daysLeft: daysBetween(today, exp),
      amount: renewalPrice(t)?.amount ?? null,
    });
  }
  return { ...renewalSummary(list, withinDays), withinDays };
}
