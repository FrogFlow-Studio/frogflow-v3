import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { toCsv } from "@/core/export/csv";

/**
 * Отчёт продавца «Рефералы»: кто пригласил, сколько друзей пришло, сколько
 * купили (награда выдана), какие коды выданы и использованы ли они; итоги за
 * 30 дней. Чтение постранично, без обрезки; любой сбой — `serverFailure`.
 */
export type ReferralReportRow = {
  referrerId: number;
  name: string;
  came: number;
  bought: number;
  codes: Array<{ code: string; used: boolean }>;
};

export type ReferralReport = {
  rows: ReferralReportRow[];
  total: { came: number; bought: number };
  last30: { came: number; bought: number };
};

const DAY = 86_400_000;

export async function referralReport(
  ctx: TenantContext,
  now = new Date(),
): Promise<ReferralReport> {
  const refs = await pageAll<{
    id: string;
    referrer_telegram_id: number;
    status: string;
    reward_promo_code: string | null;
    created_at: string;
    rewarded_at: string | null;
  }>(
    (from, to) =>
      ctx.db
        .from("referrals")
        .select("id, referrer_telegram_id, status, reward_promo_code, created_at, rewarded_at")
        .order("id")
        .range(from, to),
    "[referral] отчёт: приглашения",
  );
  const referrerIds = [...new Set(refs.map((r) => Number(r.referrer_telegram_id)))];
  const [users, promos] = await Promise.all([
    inChunks(
      referrerIds,
      (chunk) =>
        ctx.db
          .from("bot_users")
          .select("telegram_id, first_name, last_name, username")
          .in("telegram_id", chunk),
      "[referral] отчёт: пригласившие",
    ),
    inChunks(
      refs.flatMap((r) => (r.reward_promo_code ? [r.reward_promo_code] : [])),
      (chunk) => ctx.db.from("promo_codes").select("code, used_count, max_uses").in("code", chunk),
      "[referral] отчёт: коды",
    ),
  ]);
  const nameOf = new Map<number, string>();
  for (const u of users) {
    const id = Number(u.telegram_id);
    if (nameOf.has(id)) continue;
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    nameOf.set(id, full || (u.username ? `@${u.username}` : String(id)));
  }
  const spent = new Map(
    promos.map((p) => [p.code, p.max_uses != null && (p.used_count ?? 0) >= p.max_uses]),
  );
  const since = now.getTime() - 30 * DAY;
  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
  const byReferrer = new Map<number, ReferralReportRow>();
  const total = { came: 0, bought: 0 };
  const last30 = { came: 0, bought: 0 };
  for (const r of refs) {
    const id = Number(r.referrer_telegram_id);
    let row = byReferrer.get(id);
    if (!row) {
      row = { referrerId: id, name: nameOf.get(id) ?? String(id), came: 0, bought: 0, codes: [] };
      byReferrer.set(id, row);
    }
    row.came++;
    total.came++;
    if (at(r.created_at) >= since) last30.came++;
    if (r.status === "rewarded") {
      row.bought++;
      total.bought++;
      if (at(r.rewarded_at) >= since) last30.bought++;
    }
    if (r.reward_promo_code)
      row.codes.push({ code: r.reward_promo_code, used: spent.get(r.reward_promo_code) ?? false });
  }
  const rows = [...byReferrer.values()].sort(
    (a, b) => b.came - a.came || b.bought - a.bought || a.referrerId - b.referrerId,
  );
  return { rows, total, last30 };
}

export async function referralReportCsv(
  ctx: TenantContext,
  now = new Date(),
): Promise<{ csv: string; count: number }> {
  const report = await referralReport(ctx, now);
  const rows = report.rows.map((r) => [
    r.name,
    r.referrerId,
    r.came,
    r.bought,
    r.codes.map((c) => `${c.code}${c.used ? " (использован)" : ""}`).join(", "),
  ]);
  return {
    csv: toCsv(["Пригласил", "Telegram ID", "Пришло", "Купили", "Выданные коды"], rows),
    count: rows.length,
  };
}
