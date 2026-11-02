import type { CaseKind, QueuedNotification, SendOutcome } from "../core/cases/cases";
import { claimNotifications, finishNotification } from "../core/cases/cases";
import type { V4Db } from "../core/db";
import { CASE_CARDS, type SellerLang } from "../screens/screens";

/**
 * Отправка уведомлений v4 (v4.notifications, migrations/v4/003): срочные —
 * сразу, сводные — одним сообщением на магазин и адресата (решение 66).
 *
 * «Один раз» держит база: claim_notifications ставит «sending» с арендой, и
 * второй исполнитель ту же строку не возьмёт; итог (sent/failed/unknown)
 * окончательный — «могло дойти» не повторяем (CLAUDE.md). Куда и на каком
 * языке слать, решает адаптер канала (resolve): продавцу — в его чат
 * уведомлений, оператору — в чат платформы, покупателю — в его канал.
 */

export type NotifyTarget = {
  lang: SellerLang;
  send: (text: string, signal: AbortSignal) => Promise<SendOutcome>;
};
export type NotifyDeps = {
  db: V4Db;
  /** null — слать некуда (чат не подключён): уведомление «failed», без повтора. */
  resolve: (n: QueuedNotification) => Promise<NotifyTarget | null>;
  /** Ссылка на «Сегодня (v4)» магазина. */
  panelUrl: (botId: string) => string;
  budgetMs?: number;
  perSendMs?: number;
  now?: () => number;
  /** Только эти магазины (обслуживаемые v4); остальные остаются в очереди. */
  botIds?: readonly string[];
};

type L = Record<SellerLang, string>;
const T = {
  reminder: { ru: "Напоминание", kk: "Еске салу", en: "Reminder", uz: "Eslatma" },
  order: { ru: "Заказ", kk: "Тапсырыс", en: "Order", uz: "Buyurtma" },
  open: {
    ru: "Открыть «Сегодня»",
    kk: "«Бүгін» ашу",
    en: "Open «Today»",
    uz: "«Bugun»ni ochish",
  },
  returned: {
    ru: "Вы не ответили покупателю вовремя — диалог снова ведёт бот",
    kk: "Сатып алушыға уақытында жауап бермедіңіз — диалогты қайтадан бот жүргізеді",
    en: "You didn't reply to the buyer in time — the bot is handling the chat again",
    uz: "Xaridorga o'z vaqtida javob bermadingiz — suhbatni yana bot olib boradi",
  },
  digest: {
    ru: "Сводка за ночь",
    kk: "Түнгі қорытынды",
    en: "Overnight summary",
    uz: "Tungi xulosa",
  },
  clubEnds: {
    ru: "Ваш доступ в клуб заканчивается {date}. Чтобы продлить, напишите нам здесь.",
    kk: "Клубқа қолжетімділігіңіз {date} аяқталады. Ұзарту үшін бізге осында жазыңыз.",
    en: "Your club access ends on {date}. To renew, message us here.",
    uz: "Klubga kirishingiz {date} da tugaydi. Uzaytirish uchun bizga shu yerda yozing.",
  },
  escalated: {
    ru: "Поднято оператору",
    kk: "Операторға жіберілді",
    en: "Escalated to the operator",
    uz: "Operatorga yuborildi",
  },
} satisfies Record<string, L>;
export const NOTIFY_TEXTS = T;

const LOCALE: L = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB", uz: "uz-UZ" };

/** Одна строка уведомления на языке адресата; null — вид неизвестен. */
export function notificationLine(n: QueuedNotification, lang: SellerLang): string | null {
  const [what, kind] = n.kind.split(":") as [string, CaseKind | undefined];
  const orderNo =
    n.params.order_no != null ? ` · ${T.order[lang]} №${String(n.params.order_no)}` : "";
  if (what === "handoff_returned") return T.returned[lang];
  if (what === "club_renew_reminder") {
    const ends = typeof n.params.ends_at === "string" ? new Date(n.params.ends_at) : null;
    return ends ? T.clubEnds[lang].replace("{date}", ends.toLocaleDateString(LOCALE[lang])) : null;
  }
  const card = kind ? CASE_CARDS[kind] : undefined;
  if (!card) return null;
  if (what === "case_opened") return `${card.title[lang]}${orderNo}`;
  if (what === "case_reminder") return `${T.reminder[lang]}: ${card.title[lang]}${orderNo}`;
  if (what === "case_escalated") return `${T.escalated[lang]}: ${card.title[lang]}${orderNo}`;
  return null;
}

function message(lines: string[], lang: SellerLang, n: QueuedNotification, url: string | null) {
  const body = lines.length > 1 ? [`${T.digest[lang]}:`, ...lines.map((l) => `• ${l}`)] : lines;
  return n.audience === "buyer" || !url
    ? body.join("\n")
    : [...body, `${T.open[lang]}: ${url}`].join("\n");
}

export type NotifyReport = {
  sent: number;
  failed: number;
  unknown: number;
  skipped: number;
  released: number;
};

/**
 * Разослать уведомления срочности `urgency`. Сводные группируются по
 * магазину и адресату (покупателю — по каждому отдельно) в одно сообщение.
 */
export async function runNotifications(
  deps: NotifyDeps,
  urgency: "now" | "digest",
): Promise<NotifyReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 100_000;
  const perSend = deps.perSendMs ?? 10_000;
  const report: NotifyReport = { sent: 0, failed: 0, unknown: 0, skipped: 0, released: 0 };
  const claimed = await claimNotifications(deps.db, urgency, 200, deps.botIds);
  const groups = new Map<string, QueuedNotification[]>();
  for (const n of claimed) {
    const who = n.audience === "buyer" ? `buyer:${String(n.params.buyer_id ?? n.id)}` : n.audience;
    const key = urgency === "digest" ? `${n.botId}|${who}` : `${n.id}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const finishAll = async (group: QueuedNotification[], outcome: SendOutcome, error?: string) => {
    for (const n of group) await finishNotification(deps.db, n.id, outcome, error);
    report[outcome === "sent" ? "sent" : outcome === "failed" ? "failed" : "unknown"] +=
      group.length;
  };
  for (const group of groups.values()) {
    const first = group[0]!;
    if (now() - started > budget - perSend) {
      // Не успели: не отправляли — возвращаем в очередь (иначе аренда истечёт
      // и tick запишет «неизвестно», хотя отправки не было).
      for (const n of group) await deps.db.call("release_notification", { p_id: n.id });
      report.released += group.length;
      continue;
    }
    const target = await deps.resolve(first);
    if (!target) {
      await finishAll(group, "failed", "некуда отправить");
      continue;
    }
    const lines = group
      .map((n) => notificationLine(n, target.lang))
      .filter((l): l is string => l !== null);
    if (!lines.length) {
      await finishAll(group, "failed", `неизвестный вид: ${first.kind}`);
      report.skipped += group.length;
      continue;
    }
    const url = first.audience === "seller" ? deps.panelUrl(first.botId) : null;
    let outcome: SendOutcome;
    try {
      outcome = await target.send(
        message(lines, target.lang, first, url),
        AbortSignal.timeout(perSend),
      );
    } catch {
      outcome = "unknown";
    }
    await finishAll(group, outcome, outcome === "sent" ? undefined : `отправка: ${outcome}`);
  }
  return report;
}
