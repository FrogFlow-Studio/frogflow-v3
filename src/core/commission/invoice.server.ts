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
 * отклонён: у такого счёта владелец ничего не платит, месяц снова свободен
 * (отметку снимает `releaseCommissionInvoice`, а мёртвая отметка и так не считается).
 *
 * Поздняя оплата (К1): вместе с отметкой месяца записывается выставленная
 * сумма `amounts[месяц]`. Заказ месяца, оплаченный после выставления счёта,
 * поднимает комиссию месяца выше этой суммы; разница уходит строкой «Доплата»
 * в следующий счёт. Доплату закрепляет та же условная запись по `settings.rev`:
 * она сверяет `amounts[месяц]` с суммой, от которой считали, — проигравший
 * гонку пересчитывает и видит разницу 0, заказ в двух счетах не окажется.
 * Месяцы, выставленные до К1, суммы не имеют и не доплачиваются; уменьшение
 * (возврат после счёта) не кредитуется — только доплата вверх.
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
  /** Месяцы первых строк (полный месяц), по порядку. */
  months: string[];
  /** Доплаты — последние строки `lines`, по порядку; `prev` — сумма месяца в прежних счетах. Нет доплат — поля нет. */
  topups?: Array<{ month: string; prev: number }>;
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
  const amounts = tenant.settings.commission?.amounts ?? {};
  const topup = tenant.settings.commission?.topup ?? {};
  const marks = [...Object.values(billed), ...Object.values(topup).map((t) => t.invoice)];
  const live = marks.length ? await liveInvoices([...new Set(marks)]) : new Set<string>();
  const out: CommissionBilling = { lines: [], months: [] };
  const topups: Array<{ month: string; prev: number; line: InvoiceLine }> = [];
  for (const month of months) {
    const mark = billed[month];
    const last = topup[month];
    const base = last && !live.has(last.invoice) ? last.prev : amounts[month];
    // Месяц уже выставлен без суммы (до К1) — пересчитывать нечего.
    if (mark && live.has(mark) && base === undefined) continue;
    const c = await commissionForMonth(ctx, month, true);
    const amount = Math.round(c.commission);
    if (mark && live.has(mark)) {
      // Месяц уже выставлен: смотрим, не выросла ли комиссия из-за поздно оплаченных заказов.
      if (c.accrues && base !== undefined && amount > base) {
        const [y, m] = month.split("-");
        topups.push({
          month,
          prev: base,
          line: {
            title: `Доплата комиссии за ${m}.${y} (заказы, оплаченные после выставления счёта за месяц, всего ${fmt(amount)} ₸, уже выставлено ${fmt(base)} ₸)`,
            amount: amount - base,
          },
        });
      }
      continue;
    }
    if (!c.accrues || amount <= 0) continue;
    const [y, m] = month.split("-");
    out.lines.push({
      title: `Комиссия платформы за ${m}.${y} (${c.rate} % с продаж ${fmt(c.sales)} ₸ сверх ${fmt(c.freeLimit)} ₸)`,
      amount,
    });
    out.months.push(month);
  }
  if (topups.length) {
    out.lines.push(...topups.map((t) => t.line));
    out.topups = topups.map(({ month, prev }) => ({ month, prev }));
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
 * Закрепить за счётом месяцы и доплаты из `c`: условная запись по `settings.rev`.
 * Месяц занят, если за ним стоит действующий счёт другого номера, а доплата
 * устарела, если сумма месяца в настройках уже не `prev` (другой счёт
 * доплатил раньше) → false, ничего не пишем.
 */
export async function claimCommissionMonths(
  botId: string,
  c: CommissionBilling,
  invoiceId: string,
): Promise<boolean> {
  const db = serviceDb();
  const topups = c.topups ?? [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: комиссия не прочитала настройки (${error.message})`);
    if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
    const raw = asObject(data.settings);
    const commission = asObject(raw.commission);
    const billed = { ...(asObject(commission.billed) as Record<string, unknown>) };
    const amounts = { ...asObject(commission.amounts) };
    const topup = { ...asObject(commission.topup) };
    const other = [
      ...new Set(
        c.months
          .map((m) => billed[m])
          .filter((id): id is string => typeof id === "string" && id !== invoiceId),
      ),
    ];
    if (other.length && (await liveInvoices(other)).size) return false;
    c.months.forEach((m, i) => {
      billed[m] = invoiceId;
      amounts[m] = c.lines[i]!.amount;
      delete topup[m];
    });
    const first = c.months.length;
    for (const [i, t] of topups.entries()) {
      const now = amounts[t.month];
      const last = asObject(topup[t.month]);
      const effective =
        typeof last.invoice === "string" &&
        typeof last.prev === "number" &&
        (await liveInvoices([last.invoice])).size === 0
          ? last.prev
          : now;
      if (effective !== t.prev) return false;
      amounts[t.month] = t.prev + c.lines[first + i]!.amount;
      topup[t.month] = { invoice: invoiceId, prev: t.prev };
    }
    const rev = settingsRev(raw);
    const nextCommission: Record<string, unknown> = { ...commission, billed, amounts };
    if (Object.keys(topup).length) nextCommission.topup = topup;
    else delete nextCommission.topup;
    const nextSettings = { ...raw, commission: nextCommission, rev: nextSettingsRev(raw) };
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
    const amounts = { ...asObject(commission.amounts) };
    const topup = { ...asObject(commission.topup) };
    const mine = Object.keys(billed).filter((m) => billed[m] === invoiceId);
    const mineTopup = Object.keys(topup).filter((m) => asObject(topup[m]).invoice === invoiceId);
    if (!mine.length && !mineTopup.length) return false;
    for (const m of mine) {
      delete billed[m];
      delete amounts[m];
      delete topup[m];
    }
    // Отменённая доплата возвращает месяцу прежнюю сумму: следующий счёт доплатит снова.
    for (const m of mineTopup) {
      const prev = asObject(topup[m]).prev;
      if (typeof prev === "number") amounts[m] = prev;
      delete topup[m];
    }
    const rev = settingsRev(raw);
    const nextCommission: Record<string, unknown> = { ...commission };
    for (const [key, v] of [
      ["billed", billed],
      ["amounts", amounts],
      ["topup", topup],
    ] as const)
      if (Object.keys(v).length) nextCommission[key] = v;
      else delete nextCommission[key];
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
