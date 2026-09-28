import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Партнёрская программа агентств: агентство приводит продавцов и получает
 * процент с их оплат подписки. Список партнёров — `operator_settings`
 * ключ `partners` (KV платформы, схема не меняется), партнёр клиента —
 * `bots.settings.partner` (код). Код ставится при регистрации по ссылке
 * `/signup?partner=<код>` или оператором. Партнёр смотрит свой отчёт по
 * подписанной ссылке `/partner/<код>?t=<подпись>` — только своих клиентов.
 */
export const PARTNERS_KEY = "partners";
export const PARTNER_CODE_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const MAX_PERCENT = 50;

export type Partner = { code: string; name: string; contact: string; percent: number };

export function cleanPartner(p: Partial<Partner>): Partner | null {
  const code = String(p.code ?? "")
    .trim()
    .toLowerCase();
  const name = String(p.name ?? "")
    .trim()
    .slice(0, 120);
  const percent = Number(p.percent);
  if (!PARTNER_CODE_RE.test(code) || !name) return null;
  if (!Number.isFinite(percent) || percent < 0 || percent > MAX_PERCENT) return null;
  return {
    code,
    name,
    contact: String(p.contact ?? "")
      .trim()
      .slice(0, 200),
    percent: Math.round(percent * 100) / 100,
  };
}

export function parsePartners(raw: string | null | undefined): Partner[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: Partner[] = [];
    for (const x of v) {
      const p = cleanPartner((x ?? {}) as Partial<Partner>);
      if (p && !seen.has(p.code)) {
        seen.add(p.code);
        out.push(p);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Добавить или заменить партнёра по коду. */
export function upsertPartner(list: Partner[], p: Partner): Partner[] {
  const i = list.findIndex((x) => x.code === p.code);
  return i < 0 ? [...list, p] : list.map((x, j) => (j === i ? p : x));
}

export function partnerToken(secret: string, code: string): string {
  return createHmac("sha256", secret)
    .update(`ff-partner\0${code}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyPartnerToken(secret: string, code: string, token: string): boolean {
  const want = Buffer.from(partnerToken(secret, code));
  const got = Buffer.from(String(token));
  return want.length === got.length && timingSafeEqual(want, got);
}

export type PartnerClient = { botId: string; name: string; plan: string; since: string | null };
export type Payment = { bot_id: string; paid_at: string; amount: number; currency: string };

export type PartnerReport = {
  partner: Partner;
  clients: Array<PartnerClient & { paid: Record<string, number> }>;
  /** По месяцам (YYYY-MM) и валютам: оплачено клиентами и комиссия партнёра. */
  months: Array<{ month: string; currency: string; paid: number; commission: number }>;
  totals: Array<{ currency: string; paid: number; commission: number }>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Отчёт партнёра: его клиенты, их оплаты подписки и комиссия по месяцам. */
export function partnerReport(
  partner: Partner,
  clients: PartnerClient[],
  payments: Payment[],
): PartnerReport {
  const ids = new Set(clients.map((c) => c.botId));
  const mine = payments.filter((p) => ids.has(p.bot_id));
  const byClient = new Map<string, Record<string, number>>();
  const byMonth = new Map<string, number>();
  const byCurrency = new Map<string, number>();
  for (const p of mine) {
    const cur = p.currency.toUpperCase();
    const amt = Number(p.amount) || 0;
    const c = byClient.get(p.bot_id) ?? {};
    c[cur] = round2((c[cur] ?? 0) + amt);
    byClient.set(p.bot_id, c);
    const mk = `${p.paid_at.slice(0, 7)}|${cur}`;
    byMonth.set(mk, round2((byMonth.get(mk) ?? 0) + amt));
    byCurrency.set(cur, round2((byCurrency.get(cur) ?? 0) + amt));
  }
  const pct = partner.percent / 100;
  return {
    partner,
    clients: clients.map((c) => ({ ...c, paid: byClient.get(c.botId) ?? {} })),
    months: [...byMonth.entries()]
      .map(([k, paid]) => {
        const [month, currency] = k.split("|") as [string, string];
        return { month, currency, paid, commission: round2(paid * pct) };
      })
      .sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency)),
    totals: [...byCurrency.entries()].map(([currency, paid]) => ({
      currency,
      paid,
      commission: round2(paid * pct),
    })),
  };
}
