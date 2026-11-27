import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";

/**
 * ИИ-кошелёк магазина (migrations/v4/018-ai-wallet.sql): бронь перед вызовом
 * модели, расчёт по факту с наценкой, возврат. Остаток меняют только SQL-функции
 * под блокировкой строки кошелька.
 */

/** Бронь на один ответ: с запасом на 4 круга модели (≈0,05 долл. до наценки). */
export const HOLD_MICRO_USD = 60_000;

export type HoldResult =
  { ok: true; holdId: number } | { ok: false; reason: "wallet_empty" | "limit_day" };

const iso = (now?: Date) => (now ? { p_now: now.toISOString() } : {});

function scalar<T>(rows: Record<string, unknown>[], fn: string): T {
  const r = rows[0];
  if (!r || !(fn in r)) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r[fn] as T;
}

export async function aiHold(
  db: V4Db,
  a: {
    botId: string;
    buyerId?: string | null;
    amountMicroUsd?: number;
    purpose: string;
    dailyCapMicroUsd?: number | null;
    mode: "live" | "test";
    now?: Date;
  },
): Promise<HoldResult> {
  const r = scalar<{ ok: boolean; hold_id?: number; reason?: string }>(
    await db.call("ai_hold", {
      p_bot_id: a.botId,
      p_amount_micro_usd: a.amountMicroUsd ?? HOLD_MICRO_USD,
      p_purpose: a.purpose,
      p_buyer_id: a.buyerId ?? null,
      p_daily_cap_micro_usd: a.dailyCapMicroUsd ?? null,
      p_mode: a.mode,
      ...iso(a.now),
    }),
    "ai_hold",
  );
  if (r.ok) return { ok: true, holdId: Number(r.hold_id) };
  return { ok: false, reason: r.reason === "limit_day" ? "limit_day" : "wallet_empty" };
}

/** Расчёт брони по факту: списано с наценкой (микродоллары). */
export async function aiSettle(
  db: V4Db,
  a: { botId: string; holdId: number; apiMicroUsd: number; markupBp: number; now?: Date },
): Promise<number> {
  return Number(
    scalar(
      await db.call("ai_settle", {
        p_bot_id: a.botId,
        p_hold_id: a.holdId,
        p_api_micro_usd: Math.max(0, Math.round(a.apiMicroUsd)),
        p_markup_bp: a.markupBp,
        ...iso(a.now),
      }),
      "ai_settle",
    ),
  );
}

export async function aiRelease(
  db: V4Db,
  a: { botId: string; holdId: number; now?: Date },
): Promise<void> {
  await db.call("ai_release", { p_bot_id: a.botId, p_hold_id: a.holdId, ...iso(a.now) });
}

/** Итог с наценкой, как в базе: округление вверх до микродоллара. */
export function withMarkup(apiMicroUsd: number, markupBp: number): number {
  return Math.ceil((Math.max(0, apiMicroUsd) * (10_000 + markupBp)) / 10_000);
}

// ── наценка без сбоев (12.4 проекта, решение В1) ─────────────────────────────

export type MarkupSource = {
  /** Настройка оператора, % (operator_settings.ai_markup_percent). */
  readPercent(): Promise<number>;
  /** Последняя наценка из книги ИИ, базисные пункты; null — записей нет. */
  lastLedgerBp(): Promise<number | null>;
  /** Дело оператору «наценка не читается» (одно в сутки — ключ в базе). */
  reportFailure(detail: string): Promise<void>;
  sleep?(ms: number): Promise<void>;
};

export type MarkupState = { lastGoodBp: number | null; cache: { at: number; bp: number } | null };

export const newMarkupState = (): MarkupState => ({ lastGoodBp: null, cache: null });

const percentToBp = (p: number) =>
  Number.isFinite(p) && p > 0 ? Math.min(100_000, Math.round(p * 100)) : 0;

/**
 * Наценка в базисных пунктах. Кэш на минуту. Сбой чтения — один повтор через
 * 300 мс; не помогло — последнее удачное значение процесса, после перезапуска —
 * из последней записи книги. 0 — только если удачных чтений не было никогда.
 * Каждый запасной случай — дело оператору.
 */
export async function markupBp(
  src: MarkupSource,
  state: MarkupState,
  now = Date.now(),
): Promise<{ bp: number; fallback: null | "process" | "ledger" | "zero" }> {
  if (state.cache && now - state.cache.at < 60_000) return { bp: state.cache.bp, fallback: null };
  const sleep = src.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const bp = percentToBp(await src.readPercent());
      state.cache = { at: now, bp };
      state.lastGoodBp = bp;
      return { bp, fallback: null };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === 0) await sleep(300);
    }
  }
  let bp: number;
  let fallback: "process" | "ledger" | "zero";
  if (state.lastGoodBp !== null) {
    bp = state.lastGoodBp;
    fallback = "process";
  } else {
    const ledger = await src.lastLedgerBp().catch(() => null);
    if (ledger !== null) {
      bp = ledger;
      fallback = "ledger";
    } else {
      bp = 0;
      fallback = "zero";
    }
  }
  console.error(`[v4 ai] наценка не прочитана (${lastError}), беру ${bp} б.п. (${fallback})`);
  await src.reportFailure(`${fallback}: ${lastError}`).catch(() => undefined);
  return { bp, fallback };
}

/**
 * Источник наценки поверх базы v4: процент читает переданная функция
 * (v3: operator_settings). Дело «наценка не читается» — у магазина, который
 * сейчас отвечает (владелец по политике — оператор), одно в сутки.
 */
export function v4MarkupSource(
  db: V4Db,
  readPercent: () => Promise<number>,
  botId: string,
  now = () => new Date(),
): MarkupSource {
  return {
    readPercent,
    async lastLedgerBp() {
      const v = scalar<number | null>(await db.call("ai_last_markup_bp", {}), "ai_last_markup_bp");
      return v === null ? null : Number(v);
    },
    async reportFailure(detail) {
      await db.call("open_case", {
        p_bot_id: botId,
        p_kind: "ai_markup",
        p_dedupe_key: `day:${now().toISOString().slice(0, 10)}`,
        p_created_by: "ai",
        p_detail: { detail },
      });
    },
  };
}
