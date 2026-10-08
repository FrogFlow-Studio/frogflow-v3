import type { ConsultantProduct } from "./pricelist/catalog";
import { indexCatalog } from "./pricelist/eval/checks";
import { replyFlags } from "./pricelist/quality-digest";

/**
 * Журнал ответов консультанта для продавца (партия 3.4): строки
 * consultant_message_runs по диалогу — что спросил покупатель, что ответил
 * бот, замечания проверки (те же, что в утренней сводке качества), передал
 * менеджеру или промолчал; и счёт по дням. Только чтение, чистые функции.
 */

export type JournalRow = {
  id: string;
  conversation_id: string | null;
  status: string | null;
  incoming_text: string | null;
  reply_text: string | null;
  reply_kind: string | null;
  received_at: string;
};

/** Чем кончился ход: ответ, передача менеджеру, молчание (и почему), сбой отправки. */
export type RunOutcome =
  | { kind: "replied" }
  | { kind: "handoff"; reason: string }
  | { kind: "silent"; why: "paused" | "manager" | "folded" | "busy" | "stale" | "other" }
  | { kind: "failed" };

const SILENT = ["paused", "manager", "folded", "busy", "stale"] as const;

export function runOutcome(r: Pick<JournalRow, "status" | "reply_kind">): RunOutcome {
  const kind = r.reply_kind ?? "";
  if (r.status === "cancelled") {
    const why = (SILENT as readonly string[]).includes(kind)
      ? (kind as (typeof SILENT)[number])
      : "other";
    return { kind: "silent", why };
  }
  if (r.status === "terminal_failed") return { kind: "failed" };
  const handoff = /^handoff:?(.*)$/.exec(kind);
  if (handoff) return { kind: "handoff", reason: handoff[1] || "handoff" };
  if (kind === "purchase") return { kind: "handoff", reason: "purchase" };
  return { kind: "replied" };
}

/** Передача менеджеру — как считает утренняя сводка качества. */
export const isHandoffRun = (r: Pick<JournalRow, "status" | "reply_kind">) =>
  runOutcome(r).kind === "handoff";

/** Замечания проверки: имя проверки сводки качества → ключ подписи в панели. */
const FLAG_IDS: Record<string, string> = {
  цена: "price",
  длина: "length",
  вопросы: "questions",
  бюджет: "budget",
  "рекламные слова": "ads",
  приветствие: "greeting",
  "вводное слово": "opener",
  служебное: "leak",
  "за покупателя": "forBuyer",
  "на ты": "informal",
  язык: "language",
  "эмодзи или «!»": "emoji",
};
export const FLAG_KEYS = [...Object.values(FLAG_IDS), "other"] as const;
export type FlagId = (typeof FLAG_KEYS)[number];

export function flagId(check: string): FlagId {
  return (FLAG_IDS[check] as FlagId | undefined) ?? "other";
}

export type JournalEntry = {
  id: string;
  at: string;
  question: string;
  answer: string;
  outcome: RunOutcome;
  flags: FlagId[];
};

/**
 * Строки журнала с замечаниями. «Первое сообщение» (приветствие можно) —
 * первый ответ диалога среди показанных строк, по времени.
 */
export function journalEntries(rows: JournalRow[], catalog: ConsultantProduct[]): JournalEntry[] {
  const index = indexCatalog(catalog.filter((p) => p.stock));
  const chrono = [...rows].sort(
    (a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id),
  );
  const seen = new Set<string>();
  const flags = new Map<string, FlagId[]>();
  for (const r of chrono) {
    const outcome = runOutcome(r);
    const text = r.reply_text?.trim() ?? "";
    if (outcome.kind === "silent" || !text) continue;
    const conv = r.conversation_id ?? "";
    const first = !seen.has(conv);
    seen.add(conv);
    flags.set(r.id, [...new Set(replyFlags(text, index, first).map(flagId))]);
  }
  return rows.map((r) => ({
    id: r.id,
    at: r.received_at,
    question: r.incoming_text ?? "",
    answer: r.reply_text ?? "",
    outcome: runOutcome(r),
    flags: flags.get(r.id) ?? [],
  }));
}

export type DayStats = {
  date: string;
  dialogs: number;
  replies: number;
  handoffs: number;
  silent: number;
};

/** Дата по поясу магазина. */
export function localDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Последние `n` суток по поясу магазина, от старых к сегодняшним. */
export function lastLocalDays(now: Date, timeZone: string, n = 7): string[] {
  const today = localDay(now.toISOString(), timeZone);
  const base = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Счёт по дням: диалоги, ответы бота, передачи менеджеру, сообщения без ответа бота. Дни без строк — нули. */
export function dayStats(
  rows: Array<Pick<JournalRow, "conversation_id" | "status" | "reply_kind" | "received_at">>,
  timeZone: string,
  days: string[],
): DayStats[] {
  const by = new Map(
    days.map((d) => [d, { date: d, convs: new Set<string>(), replies: 0, handoffs: 0, silent: 0 }]),
  );
  for (const r of rows) {
    const day = by.get(localDay(r.received_at, timeZone));
    if (!day) continue;
    day.convs.add(r.conversation_id ?? "");
    const o = runOutcome(r);
    // «Вошло в соседний ответ» и «ждало соседнего» — ответ был, просто одним сообщением.
    if (o.kind === "silent" && o.why !== "folded" && o.why !== "busy") day.silent += 1;
    else if (o.kind === "replied" || o.kind === "handoff") day.replies += 1;
    if (o.kind === "handoff") day.handoffs += 1;
  }
  return days.map((d) => {
    const x = by.get(d)!;
    return {
      date: d,
      dialogs: x.convs.size,
      replies: x.replies,
      handoffs: x.handoffs,
      silent: x.silent,
    };
  });
}

/** Что проверить на «Обзоре» консультанта. Куда вести — путь страницы панели. */
export type WorkspaceAlert =
  | { key: "disabled"; to: "/admin/consultant" }
  | { key: "pricelistNone"; to: "/admin/pricelist" }
  | { key: "pricelistStale"; days: number; to: "/admin/pricelist" }
  | { key: "sheetFailing"; to: "/admin/pricelist" }
  | { key: "rateNone"; to: "/admin/pricelist" }
  | { key: "rateStale"; to: "/admin/pricelist" }
  | { key: "limitNear"; usd: number; limit: number; to: "/admin/consultant" }
  | { key: "limitReached"; limit: number; to: "/admin/consultant" }
  | { key: "modelFailing"; error: string; at: string; to: "/admin/consultant" }
  | { key: "chatOff"; to: "/admin/modules" }
  | { key: "untaggedArticles"; n: number; to: "/admin/knowledge" };

/** Прайс старше стольких дней — предупреждение (новинок консультант не знает). */
export const PRICELIST_STALE_DAYS = 7;
/** Доля дневного предела ИИ, после которой — «предел близко». */
export const LIMIT_NEAR_SHARE = 0.8;
/** Последняя ошибка модели свежее этого — «модель сбоит». */
export const MODEL_ERROR_FRESH_MS = 24 * 3_600_000;

export function workspaceAlerts(
  s: {
    enabled: boolean;
    pricelistCount: number;
    /** Когда прайс обновился последний раз (загрузка файла или удачное чтение таблицы). */
    pricelistAt: string | null;
    sheetFailing: boolean;
    rate: { fresh: boolean } | null;
    spentUsd: number;
    limitUsd: number;
    lastError: string;
    chatOn: boolean;
    untaggedArticles: number;
  },
  now = Date.now(),
): WorkspaceAlert[] {
  const out: WorkspaceAlert[] = [];
  if (!s.enabled) out.push({ key: "disabled", to: "/admin/consultant" });
  if (s.pricelistCount === 0) out.push({ key: "pricelistNone", to: "/admin/pricelist" });
  else if (s.pricelistAt) {
    const days = Math.floor((now - Date.parse(s.pricelistAt)) / 86_400_000);
    if (Number.isFinite(days) && days > PRICELIST_STALE_DAYS)
      out.push({ key: "pricelistStale", days, to: "/admin/pricelist" });
  }
  if (s.sheetFailing) out.push({ key: "sheetFailing", to: "/admin/pricelist" });
  if (!s.rate) out.push({ key: "rateNone", to: "/admin/pricelist" });
  else if (!s.rate.fresh) out.push({ key: "rateStale", to: "/admin/pricelist" });
  if (s.limitUsd > 0 && s.spentUsd >= s.limitUsd)
    out.push({ key: "limitReached", limit: s.limitUsd, to: "/admin/consultant" });
  else if (s.limitUsd > 0 && s.spentUsd >= s.limitUsd * LIMIT_NEAR_SHARE)
    out.push({ key: "limitNear", usd: s.spentUsd, limit: s.limitUsd, to: "/admin/consultant" });
  const err = /^(\S+) — ([\s\S]+)$/.exec(s.lastError.trim());
  if (err) {
    const at = Date.parse(err[1]!);
    if (Number.isFinite(at) && now - at < MODEL_ERROR_FRESH_MS)
      out.push({ key: "modelFailing", error: err[2]!, at: err[1]!, to: "/admin/consultant" });
  }
  if (!s.chatOn) out.push({ key: "chatOff", to: "/admin/modules" });
  if (s.untaggedArticles > 0)
    out.push({ key: "untaggedArticles", n: s.untaggedArticles, to: "/admin/knowledge" });
  return out;
}
