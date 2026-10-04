import { serviceDb } from "@/core/db/client.server";
import { dayKey } from "@/core/analytics/pure";
import type { InvoiceLine } from "@/core/plans/plans";
import { COMMISSION_DEFAULT_START } from "@/core/plans/registry";
import { servedByV2 } from "@/core/tenant/directory";
import {
  invalidateTenantDirectory,
  nextSettingsRev,
  settingsRev,
  tenantContext,
} from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { serverFailure } from "@/lib/server-failure";
import { monthOfDay } from "./commission";
import { commissionEnabled, commissionForMonth } from "./commission.server";

/**
 * Комиссия платформы в месячном счёте за подписку (К3). Счёт раз в месяц
 * включает строку за каждый прошедший месяц, по которому есть комиссия:
 * «Комиссия платформы за 03.2027 (5 % с продаж … ₸ сверх 50 000 ₸)».
 *
 * «Один раз»: перед выставлением месяц закрепляется за счётом условной
 * записью `settings.commission.billed[месяц] = номер счёта` по `settings.rev`;
 * проигравший гонку (двойной клик, крон и кнопка владельца разом) счёт не
 * выставляет с этой строкой. Закрепление живёт, пока счёт не отменён и не
 * отклонён: у такого счёта владелец ничего не платит, месяц снова свободен —
 * отдельного «снятия отметки» нет, мёртвая отметка просто не считается.
 * Оплаченная комиссия позже оплаченного заказа в уже выставленный счёт не
 * попадает (счёт — раз в месяц, месяц закрывается его выставлением).
 */

/** Сколько месяцев назад комиссия ещё догоняется, если начало давнее. */
export const COMMISSION_CATCHUP_MONTHS = 12;

const ymAdd = (month: string, n: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Прошедшие месяцы, которые могут войти в счёт: от начала (не глубже года) до прошлого месяца. */
export function billableMonths(start: string | undefined, now: Date, tz: string): string[] {
  const current = monthOfDay(dayKey(now, tz));
  const first = [
    monthOfDay(start || COMMISSION_DEFAULT_START),
    ymAdd(current, -COMMISSION_CATCHUP_MONTHS),
  ]
    .sort()
    .pop()!;
  const out: string[] = [];
  for (let m = first; m < current; m = ymAdd(m, 1)) out.push(m);
  return out;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const DEAD = new Set(["cancelled", "rejected"]);

/** Какие из номеров счетов ещё действуют (отправлен, на проверке, оплачен). Нет в базе — не действует. */
async function liveInvoices(ids: string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await serviceDb()
      .from("subscription_invoices")
      .select("id, status")
      .in("id", ids.slice(i, i + 200))
      .order("id");
    if (error) throw serverFailure(`[commission] счета не прочитаны: ${error.message}`);
    for (const r of data ?? []) if (!DEAD.has(r.status)) live.add(r.id);
  }
  return live;
}

export type CommissionBilling = {
  /** Строки счёта (целые тенге), по порядку месяцев. */
  lines: InvoiceLine[];
  /** Месяцы этих строк. */
  months: string[];
};

const fmt = (n: number) => Math.round(n).toLocaleString("ru").replace(/\s/g, " ");

/**
 * Строки комиссии для следующего счёта клиента. Пусто, если выключатель
 * платформы выключен, клиент ещё не на v2 или без ставки (договорной тариф),
 * либо нет месяцев с комиссией. Месяц без комиссии (до порога) в счёт не
 * входит и не закрепляется: если продажи месяца вырастут задним числом, он
 * догонится следующим счётом.
 */
export async function commissionBilling(
  tenant: Tenant,
  now = new Date(),
): Promise<CommissionBilling> {
  const none: CommissionBilling = { lines: [], months: [] };
  if (!servedByV2(tenant)) return none;
  if (!(await commissionEnabled())) return none;
  const ctx = tenantContext(tenant);
  const months = billableMonths(tenant.settings.commission?.start, now, ctx.timezone);
  if (!months.length) return none;
  const billed = tenant.settings.commission?.billed ?? {};
  const marks = Object.values(billed);
  const live = marks.length ? await liveInvoices([...new Set(marks)]) : new Set<string>();
  const out: CommissionBilling = { lines: [], months: [] };
  for (const month of months) {
    const mark = billed[month];
    if (mark && live.has(mark)) continue;
    const c = await commissionForMonth(ctx, month, true);
    const amount = Math.round(c.commission);
    if (!c.accrues || amount <= 0) continue;
    const [y, m] = month.split("-");
    out.lines.push({
      title: `Комиссия платформы за ${m}.${y} (${c.rate} % с продаж ${fmt(c.sales)} ₸ сверх ${fmt(c.freeLimit)} ₸)`,
      amount,
    });
    out.months.push(month);
  }
  return out;
}

/** Другой счёт успел закрепить месяц раньше. */
export class CommissionClaimLost extends Error {
  constructor() {
    super("Комиссия за месяц уже вошла в другой счёт");
  }
}

/**
 * Закрепить месяцы за счётом: условная запись по `settings.rev`. Месяц занят,
 * если за ним стоит действующий счёт другого номера → false, ничего не пишем.
 */
export async function claimCommissionMonths(
  botId: string,
  months: string[],
  invoiceId: string,
): Promise<boolean> {
  const db = serviceDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: комиссия не прочитала настройки (${error.message})`);
    if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
    const raw = asObject(data.settings);
    const commission = asObject(raw.commission);
    const billed = { ...(asObject(commission.billed) as Record<string, unknown>) };
    const other = [
      ...new Set(
        months
          .map((m) => billed[m])
          .filter((id): id is string => typeof id === "string" && id !== invoiceId),
      ),
    ];
    if (other.length && (await liveInvoices(other)).size) return false;
    for (const m of months) billed[m] = invoiceId;
    const rev = settingsRev(raw);
    const nextSettings = {
      ...raw,
      commission: { ...commission, billed },
      rev: nextSettingsRev(raw),
    };
    const revPath = "settings->>rev" as "id";
    let q = db
      .from("bots")
      .update({ settings: nextSettings as never })
      .eq("id", botId);
    q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
    const { data: rows, error: writeError } = await q.select("id");
    if (writeError) throw serverFailure(`bots.settings: ${writeError.message}`);
    if (rows?.length) {
      invalidateTenantDirectory();
      return true;
    }
  }
  throw serverFailure(`bots.settings: комиссия не закрепила месяцы ${botId} (гонка версий)`);
}

/**
 * Снять отметки счёта: счёт отменён или отклонён, владелец по нему ничего не
 * платит, месяцы снова свободны. Условная запись по `settings.rev`, чужие ключи
 * settings (и отметки других счетов) не трогаем. Нет отметок этого счёта —
 * ничего не пишем. Если снять не удалось, месяц всё равно освободится сам:
 * отметка отменённого/отклонённого счёта не считается (`liveInvoices`).
 */
export async function releaseCommissionInvoice(botId: string, invoiceId: string): Promise<boolean> {
  const db = serviceDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: комиссия не прочитала настройки (${error.message})`);
    if (!data) return false;
    const raw = asObject(data.settings);
    const commission = asObject(raw.commission);
    const billed = { ...asObject(commission.billed) };
    const mine = Object.keys(billed).filter((m) => billed[m] === invoiceId);
    if (!mine.length) return false;
    for (const m of mine) delete billed[m];
    const rev = settingsRev(raw);
    const nextCommission: Record<string, unknown> = { ...commission };
    if (Object.keys(billed).length) nextCommission.billed = billed;
    else delete nextCommission.billed;
    const nextSettings: Record<string, unknown> = { ...raw, rev: nextSettingsRev(raw) };
    if (Object.keys(nextCommission).length) nextSettings.commission = nextCommission;
    else delete nextSettings.commission;
    const revPath = "settings->>rev" as "id";
    let q = db
      .from("bots")
      .update({ settings: nextSettings as never })
      .eq("id", botId);
    q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
    const { data: rows, error: writeError } = await q.select("id");
    if (writeError) throw serverFailure(`bots.settings: ${writeError.message}`);
    if (rows?.length) {
      invalidateTenantDirectory();
      return true;
    }
  }
  throw serverFailure(`bots.settings: комиссия не сняла отметки счёта ${invoiceId} (гонка версий)`);
}

/** Снять отметки при отмене или отклонении счёта: сбой не мешает самой отмене, его видно в журнале ошибок. */
export async function releaseCommissionSafely(botId: string, invoiceId: string): Promise<void> {
  try {
    await releaseCommissionInvoice(botId, invoiceId);
  } catch (e) {
    const { reportError } = await import("@/lib/errors");
    await reportError(e, { where: "commission.release", botId });
  }
}
