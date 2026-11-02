import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";
import { parseProfile, type SellerProfile } from "./prompt";

/**
 * Настройки ИИ-продавца из панели (migrations/v4/011-seller-settings.sql):
 * анкета продавца — из неё консультант берёт условия оплаты и доставки, без
 * подстановок в коде (CLAUDE.md), — стоп-слова для комментариев и лимит ИИ
 * на месяц (только показ: его задаёт тариф). Запись — условная по версии,
 * чтобы не затереть сохранённое другим сотрудником.
 */

export const PROFILE_FIELDS = [
  "shop_name",
  "about",
  "payment_terms",
  "delivery_terms",
  "tone",
] as const satisfies readonly (keyof SellerProfile)[];
export const PROFILE_MAX = 2000;
export const SPAM_WORDS_MAX = 100;
export const SPAM_WORD_MAX = 60;

export type SellerSettings = {
  profile: SellerProfile;
  spamWords: string[];
  limitMicroUsd: number;
  roomMicroUsd: number;
  version: string;
};

export async function sellerSettings(db: V4Db, botId: string): Promise<SellerSettings | null> {
  const r = (await db.call("seller_settings", { p_bot_id: botId }))[0]?.seller_settings as
    Record<string, unknown> | null | undefined;
  if (!r) return null;
  return {
    profile: parseProfile(r.profile),
    spamWords: Array.isArray(r.spam_words) ? (r.spam_words as string[]) : [],
    limitMicroUsd: Number(r.limit_micro_usd),
    roomMicroUsd: Number(r.room_micro_usd),
    version: String(r.version),
  };
}

/** Стоп-слова: без пустых и повторов, в нижнем регистре, не длиннее предела. */
export function normalizeSpamWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    const v = w.trim().toLowerCase();
    if (v && v.length <= SPAM_WORD_MAX && !out.includes(v)) out.push(v);
  }
  return out.slice(0, SPAM_WORDS_MAX);
}

/** Анкета: только известные поля, обрезанные по краям; пустое поле не хранится. */
export function normalizeProfile(p: Partial<Record<string, unknown>>): SellerProfile {
  const out: SellerProfile = {};
  for (const k of PROFILE_FIELDS) {
    const v = typeof p[k] === "string" ? (p[k] as string).trim().slice(0, PROFILE_MAX) : "";
    if (v) out[k] = v;
  }
  return out;
}

export async function saveSellerSettings(
  db: V4Db,
  input: { botId: string; profile: SellerProfile; spamWords: readonly string[]; version: string },
): Promise<{ ok: true } | { ok: false; code: "stale" }> {
  const rows = await db.call("save_seller_settings", {
    p_bot_id: input.botId,
    p_profile: normalizeProfile(input.profile),
    p_spam_words: normalizeSpamWords(input.spamWords),
    p_version: input.version,
  });
  const saved = rows[0]?.save_seller_settings;
  if (typeof saved !== "boolean") throw serverFailure("v4.save_seller_settings: пустой ответ");
  return saved ? { ok: true } : { ok: false, code: "stale" };
}
