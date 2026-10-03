import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { soldForOffer, type LimitedOffer } from "./offers";

/**
 * Занятие штук по акции на время оформления заказа. Лимит акции читается по
 * проданному, а проданное появляется только когда заказ записан, — два заказа на
 * последний остаток видели бы его оба. Поэтому перед записью заказа каждый
 * занимает свои штуки в `app_settings.offer_holds` условной записью по метке
 * времени (в условие идёт метка, не значение). У занятий есть порядковый номер:
 * заказ считает только тех, кто занял раньше него, поэтому из двух одновременных
 * остаток получает один. Занятие снимается, когда позиции заказа записаны (дальше их
 * видно в проданном) или оформление сорвалось; брошенное гаснет само через `HOLD_TTL_MS`.
 * Точности «до штуки» нет, только безопасная сторона: если заказ A записал позиции и снял занятие
 * между занятием и чтением проданного у B, B вычтет A дважды и получит по акции меньше штук.
 */
export const HOLDS_KEY = "offer_holds";
export const HOLD_TTL_MS = 3 * 60_000;

type Hold = { token: string; o: string; q: number; s: number; t: number };
type Holds = { n: number; h: Record<string, Hold> };

function parseHolds(raw: string | null): Holds {
  try {
    const v = raw ? (JSON.parse(raw) as Holds) : null;
    if (v && typeof v.n === "number" && v.h && typeof v.h === "object") return v;
  } catch {
    /* битое — как пустое */
  }
  return { n: 0, h: {} };
}

const alive = (h: Hold, now: number) => now - h.t < HOLD_TTL_MS;

/**
 * Занять штуки по акциям (`want` — сколько хочет заказ по каждой). Возвращает, сколько
 * штук по каждой акции заказ вправе взять по акционной цене: остальное — по полной.
 */
export async function reserveOfferUnits(
  ctx: TenantContext,
  token: string,
  wants: ReadonlyArray<{ offer: LimitedOffer; want: number }>,
): Promise<Map<string, number>> {
  const granted = new Map<string, number>();
  const asked = wants.filter((w) => w.offer.limit != null && w.want > 0);
  if (asked.length === 0) return granted;
  const earlier = new Map<string, number>();
  const put = await updateSettingStamped(ctx, HOLDS_KEY, (raw) => {
    const now = Date.now();
    const cur = parseHolds(raw);
    const h: Record<string, Hold> = {};
    for (const [k, v] of Object.entries(cur.h)) if (alive(v, now)) h[k] = v;
    let n = cur.n;
    // Повтор записи при гонке: свои занятия прошлой попытки заменяем.
    for (const k of Object.keys(h)) if (h[k]!.token === token) delete h[k];
    earlier.clear();
    for (const v of Object.values(h)) earlier.set(v.o, (earlier.get(v.o) ?? 0) + v.q);
    for (const w of asked) {
      n += 1;
      h[`${token}:${w.offer.id}`] = { token, o: w.offer.id, q: w.want, s: n, t: now };
    }
    return JSON.stringify({ n, h });
  });
  if (put === "failed") throw serverFailure("Акции: не удалось занять штуки");
  // Занятые раньше уже видны в `earlier`; те, кого там нет, закончились раньше — их заказы
  // записаны, а проданное читается позже занятия, поэтому их штуки в нём есть.
  for (const w of asked) {
    const sold = await soldForOffer(ctx, w.offer);
    const free = Math.max(0, (w.offer.limit ?? 0) - sold - (earlier.get(w.offer.id) ?? 0));
    granted.set(w.offer.id, Math.min(w.want, free));
  }
  // Лишнее занятое отдаём сразу, чтобы следующий заказ не недобрал штуки.
  const trim = granted.size > 0 && asked.some((w) => (granted.get(w.offer.id) ?? 0) < w.want);
  if (trim) {
    const r = await updateSettingStamped(ctx, HOLDS_KEY, (raw) => {
      const cur = parseHolds(raw);
      let changed = false;
      for (const w of asked) {
        const mine = cur.h[`${token}:${w.offer.id}`];
        const g = granted.get(w.offer.id) ?? 0;
        if (!mine || mine.q === g) continue;
        changed = true;
        if (g <= 0) delete cur.h[`${token}:${w.offer.id}`];
        else mine.q = g;
      }
      return changed ? JSON.stringify(cur) : null;
    });
    if (r === "failed") console.error("[offers] занятие штук не уменьшено: гаснет само");
  }
  return granted;
}

/** Снять занятия заказа. Не получилось — они погаснут сами через `HOLD_TTL_MS`. */
export async function releaseOfferHolds(ctx: TenantContext, token: string): Promise<void> {
  try {
    const r = await updateSettingStamped(ctx, HOLDS_KEY, (raw) => {
      const cur = parseHolds(raw);
      const keys = Object.keys(cur.h).filter((k) => cur.h[k]!.token === token);
      if (keys.length === 0) return null;
      for (const k of keys) delete cur.h[k];
      return JSON.stringify(cur);
    });
    if (r === "failed") console.error("[offers] занятые штуки акции не сняты: гаснут сами");
  } catch (e) {
    console.error(`[offers] снятие занятых штук акции: ${String(e)}`);
  }
}
