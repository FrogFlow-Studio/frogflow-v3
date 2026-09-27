/**
 * Недельный отчёт продавцу: в понедельник с 9 утра по поясу магазина — итоги
 * прошлой недели (пн–вс) в бот магазина. Чистая часть: окно недели, срок,
 * текст. Отправку и отметку «отправлено» делает сервер (weekly.server).
 */
import { FUNNEL_STAGES, stageRate, type FunnelRow } from "./funnel";
import { formatMoney } from "@/core/money/money";
import { pctDelta } from "./pure";

/** Настройка в app_settings: "false" — продавец выключил отчёт; по умолчанию включён. */
export const WEEKLY_ENABLED_KEY = "weekly_report_enabled";
/** Неделя, за которую отчёт уже ушёл («2026-W39»): второй прогон крона её не повторит. */
export const WEEKLY_SENT_KEY = "weekly_report_sent_week";
export const WEEKLY_HOUR = 9;

export const weeklyEnabled = (raw: string | null | undefined) => raw !== "false";

const DAY = 86_400_000;

function localParts(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!) + 1;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday,
  };
}

/** ISO-неделя даты (по календарю, без пояса): «2026-W39». */
export function isoWeekKey(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type WeekWindow = {
  /** Прошлая неделя целиком: [from, to) — с понедельника 00:00 до понедельника 00:00 по поясу. */
  week: string;
  from: Date;
  to: Date;
  /** Неделя перед ней — для сравнения. */
  prevFrom: Date;
  /** Отчёт уже пора слать: понедельник с 9:00 и дальше до конца недели. */
  due: boolean;
  /** «21.09–27.09» для заголовка. */
  label: string;
};

export function weekWindow(now: Date, tz: string): WeekWindow {
  const l = localParts(now, tz);
  // Смещение пояса сейчас: местное время как UTC минус настоящий момент.
  const localAsUtc = Date.UTC(l.y, l.m - 1, l.d, l.hour, l.minute);
  const offset = localAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
  const todayMidnightUtc = Date.UTC(l.y, l.m - 1, l.d) - offset;
  const to = new Date(todayMidnightUtc - (l.weekday - 1) * DAY);
  const from = new Date(to.getTime() - 7 * DAY);
  const prevFrom = new Date(from.getTime() - 7 * DAY);
  const monday = new Date(Date.UTC(l.y, l.m - 1, l.d) - (l.weekday - 1) * DAY - 7 * DAY);
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const dm = (x: Date) =>
    `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    week: isoWeekKey(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    from,
    to,
    prevFrom,
    due: l.weekday > 1 || l.hour >= WEEKLY_HOUR,
    label: `${dm(monday)}–${dm(sunday)}`,
  };
}

export type WeeklyStats = {
  currency: string;
  revenue: number;
  orders: number;
  prevRevenue: number;
  prevOrders: number;
  funnel: FunnelRow[];
  top: Array<{ name: string; qty: number }>;
};

const CHANNEL: Record<string, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  web: "Витрина",
};
const STAGE: Record<string, string> = {
  arrived: "Пришли",
  cart: "Корзина",
  ordered: "Заказ",
  paid: "Оплата",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number, c: string) => formatMoney(Math.round(n), c);

function delta(cur: number, prev: number): string {
  const d = pctDelta(cur, prev);
  if (d === null || d === 0) return "";
  return ` (${d > 0 ? "▲" : "▼"} ${Math.abs(d)} % к прошлой неделе)`;
}

/** Текст отчёта (HTML для Telegram), по-русски, как остальные уведомления продавцу. */
export function renderWeekly(label: string, s: WeeklyStats): string {
  const all = s.funnel[0] ?? { arrived: 0, cart: 0, ordered: 0, paid: 0 };
  const lines = [
    `📊 <b>Итоги недели ${label}</b>`,
    "",
    `Выручка: ${money(s.revenue, s.currency)}${delta(s.revenue, s.prevRevenue)}`,
    `Оплаченных заказов: ${s.orders}${delta(s.orders, s.prevOrders)}`,
    "",
    "<b>Воронка</b>",
  ];
  FUNNEL_STAGES.forEach((st, i) => {
    const rate = i ? stageRate(all[FUNNEL_STAGES[i - 1]!], all[st]) : null;
    lines.push(`${STAGE[st]}: ${all[st]}${rate === null ? "" : ` (${rate} %)`}`);
  });
  const best = s.funnel.slice(1).sort((a, b) => b.paid - a.paid || b.ordered - a.ordered)[0];
  if (best && best.paid > 0)
    lines.push(
      "",
      `Лучший канал: ${CHANNEL[best.channel] ?? esc(best.channel)} (оплатили ${best.paid})`,
    );
  if (s.top.length) {
    lines.push("", "<b>Топ товаров</b>");
    s.top.slice(0, 3).forEach((p, i) => lines.push(`${i + 1}. ${esc(p.name)} — ${p.qty} шт.`));
  }
  lines.push("", "Подробнее — в разделе «Аналитика». Выключить отчёт можно в настройках.");
  return lines.join("\n");
}
