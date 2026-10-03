import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { aiMarkupPercent } from "./markup";
import { updateSettingAtomic } from "@/core/settings/settings";
import { balanceWarning, sellerLocaleSafe } from "./seller-text";
import { serverFailure } from "@/lib/server-failure";
import {
  AI_START_USD,
  AI_TOPUP_SEEN,
  AI_USE_LABEL,
  addCharge,
  applyDelta,
  formatBalance,
  markShort,
  parseBalance,
  parseCharges,
  round6,
  withMarkup,
  type AiBalanceState,
  type AiUse,
} from "./pure";

/**
 * ИИ-баланс клиента (решение владельца 27.09): каждый вызов ИИ этого клиента
 * списывает с баланса цену API плюс наценку оператора. Баланс кончился — ИИ
 * не зовём, вызывающий код отдаёт работу человеку (консультант — менеджеру,
 * чек — продавцу).
 *
 * Схема не меняется, всё в app_settings арендатора:
 * - `ai_balance` — {usd, low, empty}; меняется только атомарной записью
 *   (updateSettingAtomic), поэтому параллельные вызовы не списывают дважды;
 * - `ai_ledger:<время>:<id>` — пополнения, стартовые 5 $, ручные поправки;
 * - `ai_charges:<день>` — расход за день по видам ИИ.
 * Эти префиксы ночная уборка (core/retention) не трогает.
 *
 * Известные границы: бронь, которую не закрыли (процесс убит между aiReserve
 * и aiSettle/aiRelease), не истекает — сумма остаётся списанной, её вернёт
 * поправка оператора. Сбой записи расчёта или возврата только в лог.
 * Журнал пишется после изменения суммы: сбой журнала оставляет сумму верной,
 * но без строки в журнале (тоже в лог).
 *
 * Как звать:
 *   const hold = await aiReserve(ctx, "consultant", 0.03);
 *   if (hold === "short") → баланс кончился: передать менеджеру / чек продавцу;
 *   if (hold === "failed") → сбой учёта: этот вызов без ИИ, без паузы;
 *   … вызов модели …
 *   await aiSettle(ctx, hold, apiUsd);   // успех: фактическая цена API, $
 *   await aiRelease(ctx, hold);          // вызов не состоялся: вернуть бронь
 */
export const AI_BALANCE_KEY = "ai_balance";
export const AI_LEDGER_PREFIX = "ai_ledger:";
export const AI_CHARGES_PREFIX = "ai_charges:";

export type AiHold = { use: AiUse; usd: number };

/* ── журнал ────────────────────────────────────────────────────────── */

export type AiLedgerKind = "start" | "topup" | "adjust";
export type AiLedgerEntry = {
  kind: AiLedgerKind;
  usd: number;
  note?: string;
  actor?: string;
  invoiceId?: string;
  at: string;
};

async function writeLedger(ctx: TenantContext, e: Omit<AiLedgerEntry, "at">) {
  const at = new Date().toISOString();
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `${AI_LEDGER_PREFIX}${at}:${randomUUID().slice(0, 8)}`,
    value: JSON.stringify({ ...e, at }),
    updated_at: at,
  });
  if (error) console.error(`[ai-balance:${ctx.tenant.id}] журнал: ${error.message}`);
}

/** Есть ли в журнале запись о зачислении по этому счёту. */
export async function ledgerHasInvoice(ctx: TenantContext, invoiceId: string): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key")
    .like("key", `${AI_LEDGER_PREFIX}%`)
    .like("value", `%"invoiceId":${JSON.stringify(invoiceId)}%`)
    .limit(1);
  if (error) throw serverFailure(`[ai-balance] журнал: ${error.message}`);
  return Boolean(data?.length);
}

/* ── баланс ────────────────────────────────────────────────────────── */

/**
 * Баланс клиента; строки ещё нет — это подключение: стартовые 5 $ ровно один
 * раз (вставка, повтор ключа — 23505, начислил кто-то параллельно).
 */
export async function aiBalance(ctx: TenantContext): Promise<AiBalanceState> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", AI_BALANCE_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`[ai-balance] чтение: ${error.message}`);
  const cur = parseBalance(data?.value);
  if (cur) return cur;
  if (data) throw serverFailure(`[ai-balance] испорчено значение баланса клиента ${ctx.tenant.id}`);
  const start: AiBalanceState = { usd: AI_START_USD, low: false, empty: false };
  const ins = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: AI_BALANCE_KEY,
    value: formatBalance(start),
    updated_at: new Date().toISOString(),
  });
  if (!ins.error) {
    await writeLedger(ctx, {
      kind: "start",
      usd: AI_START_USD,
      note: "Стартовый лимит при подключении",
    });
    return start;
  }
  if (ins.error.code !== "23505") throw serverFailure(`[ai-balance] старт: ${ins.error.message}`);
  return aiBalance(ctx);
}

/** Баланс без начисления стартовых 5 $ — для просмотра (карточка оператора). null — ещё не начислен. */
export async function aiBalancePeek(ctx: TenantContext): Promise<AiBalanceState | null> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", AI_BALANCE_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`[ai-balance] чтение: ${error.message}`);
  return parseBalance(data?.value);
}

type Change = { before: AiBalanceState; after: AiBalanceState; warn: "low" | "empty" | null };

/**
 * Изменить баланс атомарно: `step` по прочитанному состоянию даёт новое
 * (или null — не писать). "skipped" — step отказался, "failed" — сбой базы
 * или гонка не выиграна (updateSettingAtomic): ничего не записано.
 */
async function change(
  ctx: TenantContext,
  step: (b: AiBalanceState) => { next: AiBalanceState; warn: "low" | "empty" | null } | null,
): Promise<Change | "skipped" | "failed"> {
  await aiBalance(ctx);
  let res: Change | null = null;
  let broken = false;
  const w = await updateSettingAtomic(ctx, AI_BALANCE_KEY, (raw) => {
    res = null;
    const b = parseBalance(raw);
    broken = !b;
    const s = b ? step(b) : null;
    if (!b || !s) return null;
    res = { before: b, after: s.next, warn: s.warn };
    return formatBalance(s.next);
  });
  const r = res as Change | null;
  if (w === "failed" || broken) return "failed";
  if (w !== "written" || !r) return "skipped";
  if (r.warn) await warnSeller(ctx, r.warn, r.after.usd);
  return r;
}

const by = (delta: number) => (b: AiBalanceState) => applyDelta(b, delta);

/**
 * Бронь до вызова: `estimateApiUsd` — цена вызова API с запасом, $.
 * "short" — баланса не хватает: ИИ стоит, пока не пополнят (менеджеру,
 * продавцу). "failed" — сбой учёта (база, гонка): ИИ этим вызовом не зовём,
 * но это не пустой баланс — никаких пауз и «пополните».
 */
export async function aiReserve(
  ctx: TenantContext,
  use: AiUse,
  estimateApiUsd: number,
): Promise<AiHold | "short" | "failed"> {
  try {
    const usd = withMarkup(estimateApiUsd, await aiMarkupPercent());
    let short = false;
    const r = await change(ctx, (b) => {
      short = b.usd < usd;
      return short ? markShort(b) : applyDelta(b, -usd);
    });
    if (short) return "short";
    if (typeof r === "string") {
      console.error(`[ai-balance:${ctx.tenant.id}] бронь не записана (${r})`);
      return "failed";
    }
    return { use, usd };
  } catch (e) {
    console.error(`[ai-balance:${ctx.tenant.id}] бронь: ${String(e)}`);
    return "failed";
  }
}

const logFail = (ctx: TenantContext, what: string) => (r: Change | "skipped" | "failed") => {
  if (typeof r === "string")
    console.error(`[ai-balance:${ctx.tenant.id}] ${what} не записан (${r})`);
};

/** Поменять бронь на фактическую цену (API + наценка) и записать расход дня. */
export async function aiSettle(ctx: TenantContext, hold: AiHold, apiUsd: number): Promise<void> {
  const charge = withMarkup(apiUsd, await aiMarkupPercent());
  await change(ctx, by(round6(hold.usd - charge)))
    .then(logFail(ctx, "расчёт"))
    .catch((e) => console.error(`[ai-balance:${ctx.tenant.id}] расчёт: ${String(e)}`));
  const date = new Date().toISOString().slice(0, 10);
  await updateSettingAtomic(ctx, `${AI_CHARGES_PREFIX}${date}`, (raw) =>
    JSON.stringify(addCharge(parseCharges(raw, date), hold.use, charge)),
  ).catch(() => undefined);
}

/** Вызов не состоялся (сеть, отказ API до ответа) — бронь целиком назад. */
export async function aiRelease(ctx: TenantContext, hold: AiHold): Promise<void> {
  await change(ctx, by(hold.usd))
    .then(logFail(ctx, "возврат брони"))
    .catch((e) => console.error(`[ai-balance:${ctx.tenant.id}] возврат брони: ${String(e)}`));
}

/**
 * Пополнение или ручная поправка оператора (usd со знаком) с записью в
 * журнал. Снимать ниже нуля нельзя: вернёт null. Сбой базы или гонка —
 * serverFailure: не «списать нельзя», а «не записалось».
 */
export async function aiCredit(
  ctx: TenantContext,
  e: { kind: "topup" | "adjust"; usd: number; note?: string; actor?: string; invoiceId?: string },
): Promise<AiBalanceState | null> {
  const usd = round6(e.usd);
  if (!Number.isFinite(usd) || usd === 0) return null;
  const inv = e.invoiceId;
  let already = false;
  const r = await change(ctx, (b) => {
    already = Boolean(inv && b.topups?.includes(inv));
    if (already || b.usd + usd < 0) return null;
    const d = applyDelta(b, usd);
    return inv
      ? { ...d, next: { ...d.next, topups: [...(b.topups ?? []), inv].slice(-AI_TOPUP_SEEN) } }
      : d;
  });
  // Этот счёт уже зачислен (повтор после потерянного ответа) — второй раз не
  // зачисляем; запись в журнале, если тогда не легла, дописываем.
  if (already) {
    if (inv && !(await ledgerHasInvoice(ctx, inv))) await writeLedger(ctx, { ...e, usd });
    return aiBalance(ctx);
  }
  if (r === "skipped") return null;
  if (r === "failed")
    throw serverFailure(`[ai-balance] ${e.kind} ${usd} $ для ${ctx.tenant.id} не записано`);
  await writeLedger(ctx, { ...e, usd });
  return r.after;
}

/* ── журнал для продавца и оператора ───────────────────────────────── */

export type AiJournalRow =
  | (AiLedgerEntry & { type: "ledger" })
  | { type: "charges"; date: string; use: AiUse; label: string; usd: number; calls: number };

/** Последние записи: пополнения и поправки плюс расход по дням, новые сверху. */
export async function aiJournal(ctx: TenantContext, limit = 100): Promise<AiJournalRow[]> {
  const [ledger, charges] = await Promise.all(
    [AI_LEDGER_PREFIX, AI_CHARGES_PREFIX].map((p) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${p}%`)
        .order("key", { ascending: false })
        .limit(limit),
    ),
  );
  if (ledger!.error) throw serverFailure(`[ai-balance] журнал: ${ledger!.error.message}`);
  if (charges!.error) throw serverFailure(`[ai-balance] расход: ${charges!.error.message}`);
  const rows: AiJournalRow[] = [];
  for (const r of ledger!.data ?? []) {
    try {
      rows.push({ type: "ledger", ...(JSON.parse(r.value ?? "") as AiLedgerEntry) });
    } catch {
      /* битая строка журнала — пропускаем */
    }
  }
  for (const r of charges!.data ?? []) {
    const date = r.key.slice(AI_CHARGES_PREFIX.length);
    const d = parseCharges(r.value, date);
    for (const [use, v] of Object.entries(d.uses) as [AiUse, { usd: number; calls: number }][])
      rows.push({
        type: "charges",
        date,
        use,
        label: AI_USE_LABEL[use],
        usd: v.usd,
        calls: v.calls,
      });
  }
  const at = (r: AiJournalRow) => (r.type === "ledger" ? r.at : `${r.date}T23:59:59.999Z`);
  return rows.sort((a, b) => at(b).localeCompare(at(a))).slice(0, limit);
}

/* ── предупреждения продавцу ───────────────────────────────────────── */

async function warnSeller(ctx: TenantContext, kind: "low" | "empty", usd: number) {
  const text = balanceWarning(await sellerLocaleSafe(ctx), kind, usd);
  try {
    const { adminRecipients } = await import("@/core/notify/recipients");
    const { enqueueOutbox } = await import("@/core/outbox/outbox");
    for (const chatId of await adminRecipients(ctx))
      await enqueueOutbox(
        ctx,
        { kind: "admin_notice", target: { channel: "telegram", chatId }, text, audience: "admin" },
        null,
      );
  } catch (e) {
    console.error(`[ai-balance:${ctx.tenant.id}] предупреждение: ${String(e)}`);
  }
}
