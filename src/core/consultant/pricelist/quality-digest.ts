import type { ConsultantProduct } from "./catalog";
import { checkForm, checkPrices, indexCatalog, type CatalogIndex } from "./eval/checks";

/**
 * Сводка качества консультанта за сутки — продавцу, раз в день (перенос
 * consultant-v2/quality-digest.ts v1 без «тени»: режим тени не переносим).
 * Считает код, без модели и без денег: те же проверки, что у эталонного
 * набора (цены по прайсу, длина, два вопроса, рекламные слова, «ты»,
 * эмодзи), по всем ответам из журнала consultant_message_runs за прошлые
 * сутки по поясу магазина. Включается consultant_quality_digest = "on".
 */
export const DIGEST_SETTING_KEY = "consultant_quality_digest";
export const DIGEST_SENT_KEY = "consultant_quality_digest_sent";
export const DIGEST_HOUR = 9;

export type DigestRun = {
  conversation_id: string | null;
  incoming_text: string | null;
  reply_text: string | null;
  reply_kind: string | null;
  status: string | null;
  model: string | null;
  token_usage: { usd?: number } | null;
};

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** Замечания к ответу — названия проверок, без повторов. */
export function replyFlags(text: string, index: CatalogIndex, isFirst: boolean): string[] {
  const flags = [
    ...checkPrices(text, index),
    ...checkForm({ text, kind: "", handoff: null, rate: null }, {}, isFirst),
  ].map((f) => f.check);
  if (EMOJI_RE.test(text) || text.includes("!")) flags.push("эмодзи или «!»");
  return [...new Set(flags)];
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const usd = (n: number) => `$${n.toFixed(2)}`;
const cut = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

function countFlags(list: string[][]): string {
  const counts = new Map<string, number>();
  for (const flags of list) for (const f of flags) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${f} ${n}`)
    .join(", ");
}

const NOT_MANAGER_SILENCE = new Set(["folded", "busy", "stale"]);

/** Текст сводки или null, если за сутки бот не ответил ни разу. */
export function buildQualityDigest(
  runs: DigestRun[],
  catalog: ConsultantProduct[],
  opts: { day: string },
): string | null {
  const index = indexCatalog(catalog.filter((p) => p.stock));
  const replied = runs.filter((r) => r.status === "replied" && r.reply_text?.trim());
  if (replied.length === 0) return null;
  const seen = new Set<string>();
  const scored = replied.map((r) => {
    const conv = r.conversation_id ?? "";
    const isFirst = !seen.has(conv);
    seen.add(conv);
    return { run: r, flags: replyFlags(r.reply_text ?? "", index, isFirst) };
  });

  const dialogs = new Set(runs.map((r) => r.conversation_id)).size;
  const handoffs = replied.filter((r) => /^(handoff|purchase)/.test(r.reply_kind ?? ""));
  // Бот молчал при менеджере. Сообщение, вошедшее в соседний ход или устаревшее
  // (core/consultant/burst), — не молчание при менеджере.
  const paused = runs.filter(
    (r) => r.status === "cancelled" && !NOT_MANAGER_SILENCE.has(r.reply_kind ?? ""),
  ).length;
  const noModel = replied.filter((r) => !r.model).length;
  const cost = runs.reduce((sum, r) => sum + (Number(r.token_usage?.usd) || 0), 0);
  const clean = scored.filter((s) => s.flags.length === 0).length;

  const lines = [
    `📊 Консультант за ${opts.day.split("-").reverse().slice(0, 2).join(".")}`,
    "",
    `Диалогов: ${dialogs}, ответов бота: ${replied.length}.`,
    `Передано менеджеру: ${handoffs.length}${paused ? `, отвечал менеджер (бот молчал): ${paused}` : ""}.`,
    `Без модели (шаблон или сбой): ${noModel}.`,
    `Ответы без замечаний: ${clean} из ${replied.length} (${pct(clean, replied.length)}).`,
  ];
  const flagged = scored.filter((s) => s.flags.length > 0);
  if (flagged.length) lines.push(`Замечания: ${countFlags(flagged.map((s) => s.flags))}.`);
  lines.push(
    `Расход модели: ${usd(cost)}${replied.length ? `, в среднем ${usd(cost / replied.length)} за ответ` : ""}.`,
  );
  if (flagged.length) {
    lines.push("", "Примеры:");
    for (const s of flagged.slice(0, 3)) {
      lines.push(
        `• «${cut(s.run.incoming_text ?? "", 60)}» (${s.flags.join(", ")})`,
        `  ${cut(s.run.reply_text ?? "", 180)}`,
      );
    }
  }
  return lines.join("\n").slice(0, 4000);
}

/** Смещение пояса от UTC в миллисекундах в момент `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** Прошлые сутки по поясу магазина: [начало, конец) в UTC, дата «ГГГГ-ММ-ДД» и местный час. */
export function previousLocalDay(
  now: Date,
  timeZone: string,
): { day: string; from: string; to: string; hour: number } {
  const off = offsetMs(now, timeZone);
  const local = new Date(now.getTime() + off);
  const todayStart =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
  const from = new Date(todayStart - 86_400_000);
  return {
    day: new Date(from.getTime() + off).toISOString().slice(0, 10),
    from: from.toISOString(),
    to: new Date(todayStart).toISOString(),
    hour: local.getUTCHours(),
  };
}
