import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { customerFromRow, isBlocked, setState, type Customer } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { daytime } from "@/core/winback/winback";
import { eachPage } from "@/core/db/page";

/**
 * Поздравление с днём рождения (модуль funnel): покупателю в его день —
 * текст продавца и, если задан, промокод. День рождения — в
 * `bot_users.state.birthday` как «MM-DD» (год не нужен): его вносит продавец
 * в карточке покупателя или сам покупатель по ссылке бота `?start=bday`.
 * Поздравление один раз в год: `state.birthday_sent` — год отправки.
 * Крон — раз в час днём по поясу магазина, как автоворонка.
 */
export type BirthdayConfig = { enabled: boolean; text: string; promo: string };
export const BIRTHDAY_KEY = "birthday_greeting";
export const BIRTHDAY_BATCH = 50;

export function parseBirthdayConfig(raw: string | null | undefined): BirthdayConfig {
  const d: BirthdayConfig = { enabled: false, text: "", promo: "" };
  try {
    const p = JSON.parse(raw ?? "{}") as Partial<BirthdayConfig>;
    return {
      enabled: p.enabled === true,
      text: typeof p.text === "string" ? p.text.trim().slice(0, 2000) : "",
      promo: typeof p.promo === "string" ? p.promo.trim().toUpperCase().slice(0, 40) : "",
    };
  } catch {
    return d;
  }
}

export async function loadBirthday(ctx: TenantContext): Promise<BirthdayConfig> {
  return parseBirthdayConfig(await getSetting(ctx, BIRTHDAY_KEY));
}

export async function saveBirthday(ctx: TenantContext, cfg: BirthdayConfig): Promise<void> {
  await setSetting(ctx, BIRTHDAY_KEY, JSON.stringify(parseBirthdayConfig(JSON.stringify(cfg))));
}

/** «15.03», «15.03.1990», «15/3», «03-15» → «03-15»; несуществующая дата — null. */
export function parseBirthday(raw: string): string | null {
  const s = raw.trim();
  let d: number;
  let m: number;
  // «03-15» без года — как хранится (MM-DD); точка, дробь, пробел — привычное ДД.ММ(.ГГГГ).
  const iso = /^(\d{2})-(\d{2})$/.exec(s);
  const dm = /^(\d{1,2})[./\s](\d{1,2})(?:[./\s](\d{2,4}))?$/.exec(s);
  if (iso) {
    m = Number(iso[1]);
    d = Number(iso[2]);
  } else if (dm) {
    d = Number(dm[1]);
    m = Number(dm[2]);
  } else return null;
  if (m < 1 || m > 12 || d < 1) return null;
  // 29 февраля допустимо: в невисокосный год поздравим 28-го (birthdayToday).
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  if (d > max) return null;
  return `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Сегодняшний «MM-DD» в поясе магазина и год; 28 февраля невисокосного — ещё и 29-е. */
export function birthdayToday(tz: string, now = new Date()): { days: string[]; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const year = Number(get("year"));
  const md = `${get("month")}-${get("day")}`;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return { days: md === "02-28" && !leap ? [md, "02-29"] : [md], year };
}

export function fillBirthdayText(text: string, name: string | null, promo: string): string {
  return text
    .replaceAll("{name}", name?.trim() || "")
    .replaceAll("{promo}", promo)
    .replace(/\s+,/g, ",")
    .trim();
}

export type BirthdaySender = (c: Customer, text: string) => Promise<boolean>;

export async function runBirthdays(
  ctx: TenantContext,
  send: BirthdaySender,
  now = new Date(),
): Promise<{ sent: number; failed: number; skipped?: string }> {
  const r = { sent: 0, failed: 0 };
  if (!ctx.tenant.modules.funnel) return { ...r, skipped: "module off" };
  const cfg = await loadBirthday(ctx);
  if (!cfg.enabled || !cfg.text) return { ...r, skipped: "disabled" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const { days, year } = birthdayToday(ctx.timezone, now);
  for (const day of days)
    await eachPage(
      (from, to) =>
        ctx.db
          .from("bot_users")
          .select("*")
          .eq("state->>birthday", day)
          .order("user_key")
          .range(from, to),
      "поздравления: покупатели",
      async (rows) => {
        for (const row of rows) {
          if (r.sent + r.failed >= BIRTHDAY_BATCH) return false;
          if (row.opt_out) continue;
          const c = customerFromRow(row);
          if (Number(c.state.birthday_sent) === year) continue;
          if (await isBlocked(ctx, c.telegramId)) continue;
          // Сначала отметка года: повторный запуск крона в тот же час не поздравит дважды.
          await setState(ctx, c, { ...c.state, birthday_sent: year as unknown as Json });
          const ok = await send(c, fillBirthdayText(cfg.text, c.firstName, cfg.promo)).catch(
            () => false,
          );
          if (ok) r.sent++;
          else r.failed++;
        }
        return r.sent + r.failed < BIRTHDAY_BATCH;
      },
    );
  return r;
}

/** Записать день рождения покупателя; null — убрать. */
export async function setCustomerBirthday(
  ctx: TenantContext,
  c: Customer,
  birthday: string | null,
): Promise<void> {
  const { birthday: _b, ...rest } = c.state;
  await setState(ctx, c, birthday ? { ...rest, birthday } : rest);
}
