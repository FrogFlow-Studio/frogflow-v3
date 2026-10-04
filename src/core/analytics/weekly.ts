/**
 * Недельный отчёт продавцу: в понедельник с 9 утра по поясу магазина — итоги
 * прошлой недели (пн–вс) в бот магазина. Чистая часть: окно недели, срок,
 * текст. Отправку и отметку «отправлено» делает сервер (weekly.server).
 */
import { FUNNEL_STAGES, stageRate, type FunnelRow } from "./funnel";
import { formatMoney } from "@/core/money/money";
import type { Locale } from "@/core/i18n/locale";
import { pctDelta } from "./pure";

/** Настройка в app_settings: "false" — продавец выключил отчёт; по умолчанию включён. */
export const WEEKLY_ENABLED_KEY = "weekly_report_enabled";
/** Неделя, за которую отчёт уже ушёл («2026-W39»): второй прогон крона её не повторит. */
export const WEEKLY_SENT_KEY = "weekly_report_sent_week";
export const WEEKLY_HOUR = 9;

/** Необязательные блоки недельного отчёта; выручка и заказы идут всегда. */
export const WEEKLY_SECTIONS = ["speed", "buyers", "funnel", "top"] as const;
export type WeeklySection = (typeof WEEKLY_SECTIONS)[number];
/** Настройка в app_settings: блоки через запятую, "none" — только выручка и заказы; нет значения — все блоки. */
export const WEEKLY_SECTIONS_KEY = "weekly_report_sections";

export function parseWeeklySections(raw: string | null | undefined): WeeklySection[] {
  if (raw == null || raw.trim() === "") return [...WEEKLY_SECTIONS];
  const want = new Set(raw.split(",").map((x) => x.trim()));
  return WEEKLY_SECTIONS.filter((x) => want.has(x));
}

export function serializeWeeklySections(sections: readonly string[]): string {
  const on = WEEKLY_SECTIONS.filter((x) => sections.includes(x));
  return on.length === WEEKLY_SECTIONS.length ? "" : on.length ? on.join(",") : "none";
}

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

/** Скорость заказов недели, минуты (core/analytics/speed); null — данных нет. */
export type WeeklySpeed = {
  payMedian: number | null;
  payP90: number | null;
  deliverMedian: number | null;
  /** Доля выданных без действия продавца, %. */
  autoShare: number | null;
};

/** Покупатели недели: новые и вернувшиеся, и вернувшиеся за неделю до неё (для сравнения). */
export type WeeklyBuyers = { fresh: number; returning: number; prevReturning: number };

export type WeeklyStats = {
  currency: string;
  revenue: number;
  orders: number;
  prevRevenue: number;
  prevOrders: number;
  funnel: FunnelRow[];
  top: Array<{ name: string; qty: number }>;
  speed?: WeeklySpeed | null;
  buyers?: WeeklyBuyers | null;
};

export type WeeklyChange = { metric: "revenue" | "orders" | "returning"; pct: number };

/** Изменения меньше этого порога, %, в отчёте считаются «без заметных». */
export const CHANGE_MIN_PCT = 5;

/**
 * Что изменилось сильнее всего к прошлой неделе: выручка, число заказов или
 * вернувшиеся покупатели. Без ИИ — по самому большому относительному сдвигу.
 */
export function weeklyChange(s: WeeklyStats): WeeklyChange | null {
  const candidates: Array<WeeklyChange | null> = [
    pctOf("revenue", s.revenue, s.prevRevenue),
    pctOf("orders", s.orders, s.prevOrders),
    s.buyers ? pctOf("returning", s.buyers.returning, s.buyers.prevReturning) : null,
  ];
  let best: WeeklyChange | null = null;
  for (const c of candidates)
    if (c && Math.abs(c.pct) >= CHANGE_MIN_PCT && (!best || Math.abs(c.pct) > Math.abs(best.pct)))
      best = c;
  return best;
}

function pctOf(metric: WeeklyChange["metric"], cur: number, prev: number): WeeklyChange | null {
  const d = pctDelta(cur, prev);
  return d === null || d === 0 ? null : { metric, pct: d };
}

type Words = {
  title: (label: string) => string;
  revenue: string;
  orders: string;
  vsPrev: string;
  funnel: string;
  stages: Record<"arrived" | "cart" | "ordered" | "paid", string>;
  bestChannel: (name: string, paid: number) => string;
  top: string;
  qty: (n: number) => string;
  footer: string;
  channels: Record<string, string>;
  speed: (pay: string, p90: string, deliver: string | null) => string;
  auto: (pct: number) => string;
  returning: (n: number, fresh: number) => string;
  changed: (metric: string, arrow: string, pct: number) => string;
  calm: string;
  metrics: Record<WeeklyChange["metric"], string>;
  min: string;
  hour: string;
  day: string;
};

const WORDS: Record<Locale, Words> = {
  ru: {
    title: (l) => `📊 <b>Итоги недели ${l}</b>`,
    revenue: "Выручка",
    orders: "Оплаченных заказов",
    vsPrev: "к прошлой неделе",
    funnel: "Воронка",
    stages: { arrived: "Пришли", cart: "Корзина", ordered: "Заказ", paid: "Оплата" },
    bestChannel: (n, p) => `Лучший канал: ${n} (оплатили ${p})`,
    top: "Топ товаров",
    qty: (n) => `${n} шт.`,
    footer: "Подробнее — в разделе «Аналитика». Выключить отчёт можно в настройках.",
    channels: {
      telegram: "Telegram",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
      web: "Витрина",
    },
    speed: (pay, p90, deliver) =>
      `Скорость: оплата — медиана ${pay}, 90 % заказов — до ${p90}${deliver ? `; выдача после оплаты — ${deliver}` : ""}`,
    auto: (pct) => `Выдано без вашего участия: ${pct} %`,
    returning: (n, f) => `Вернувшихся покупателей: ${n} (новых ${f})`,
    changed: (m, a, p) => `Что изменилось: ${m} ${a} ${p} %`,
    calm: "Что изменилось: без заметных сдвигов к прошлой неделе",
    metrics: { revenue: "выручка", orders: "заказы", returning: "вернувшиеся покупатели" },
    min: "мин",
    hour: "ч",
    day: "дн",
  },
  kk: {
    title: (l) => `📊 <b>Апта қорытындысы ${l}</b>`,
    revenue: "Түсім",
    orders: "Төленген тапсырыстар",
    vsPrev: "өткен аптамен салыстырғанда",
    funnel: "Воронка",
    stages: { arrived: "Келді", cart: "Себет", ordered: "Тапсырыс", paid: "Төлем" },
    bestChannel: (n, p) => `Үздік арна: ${n} (төлеген ${p})`,
    top: "Үздік тауарлар",
    qty: (n) => `${n} дана`,
    footer: "Толығырақ — «Аналитика» бөлімінде. Есепті баптаулардан өшіруге болады.",
    channels: {
      telegram: "Telegram",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
      web: "Витрина",
    },
    speed: (pay, p90, deliver) =>
      `Жылдамдық: төлем — медиана ${pay}, тапсырыстардың 90 % — ${p90} дейін${deliver ? `; төлемнен кейін беру — ${deliver}` : ""}`,
    auto: (pct) => `Сіздің қатысуыңызсыз берілді: ${pct} %`,
    returning: (n, f) => `Қайта оралған сатып алушылар: ${n} (жаңа ${f})`,
    changed: (m, a, p) => `Не өзгерді: ${m} ${a} ${p} %`,
    calm: "Не өзгерді: өткен аптамен салыстырғанда айтарлықтай өзгеріс жоқ",
    metrics: { revenue: "түсім", orders: "тапсырыстар", returning: "қайта оралған сатып алушылар" },
    min: "мин",
    hour: "сағ",
    day: "күн",
  },
  en: {
    title: (l) => `📊 <b>Week results ${l}</b>`,
    revenue: "Revenue",
    orders: "Paid orders",
    vsPrev: "vs last week",
    funnel: "Funnel",
    stages: { arrived: "Arrived", cart: "Cart", ordered: "Ordered", paid: "Paid" },
    bestChannel: (n, p) => `Best channel: ${n} (${p} paid)`,
    top: "Top products",
    qty: (n) => `${n} pcs`,
    footer: "More in the “Analytics” section. You can turn the report off in settings.",
    channels: {
      telegram: "Telegram",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
      web: "Storefront",
    },
    speed: (pay, p90, deliver) =>
      `Speed: payment — median ${pay}, 90% of orders within ${p90}${deliver ? `; delivery after payment — ${deliver}` : ""}`,
    auto: (pct) => `Delivered without your action: ${pct}%`,
    returning: (n, f) => `Returning customers: ${n} (new ${f})`,
    changed: (m, a, p) => `What changed: ${m} ${a} ${p}%`,
    calm: "What changed: nothing notable vs last week",
    metrics: { revenue: "revenue", orders: "orders", returning: "returning customers" },
    min: "min",
    hour: "h",
    day: "d",
  },
  uz: {
    title: (l) => `📊 <b>Hafta yakunlari ${l}</b>`,
    revenue: "Tushum",
    orders: "To‘langan buyurtmalar",
    vsPrev: "o‘tgan haftaga nisbatan",
    funnel: "Voronka",
    stages: { arrived: "Kirdi", cart: "Savat", ordered: "Buyurtma", paid: "To‘lov" },
    bestChannel: (n, p) => `Eng yaxshi kanal: ${n} (to‘lagan ${p})`,
    top: "Top mahsulotlar",
    qty: (n) => `${n} dona`,
    footer: "Batafsil — «Analitika» bo‘limida. Hisobotni sozlamalarda o‘chirish mumkin.",
    channels: {
      telegram: "Telegram",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
      web: "Vitrina",
    },
    speed: (pay, p90, deliver) =>
      `Tezlik: to‘lov — mediana ${pay}, buyurtmalarning 90 % i ${p90} gacha${deliver ? `; to‘lovdan keyin topshirish — ${deliver}` : ""}`,
    auto: (pct) => `Sizning ishtirokingizsiz topshirilgan: ${pct} %`,
    returning: (n, f) => `Qaytgan xaridorlar: ${n} (yangi ${f})`,
    changed: (m, a, p) => `Nima o‘zgardi: ${m} ${a} ${p} %`,
    calm: "Nima o‘zgardi: o‘tgan haftaga nisbatan sezilarli o‘zgarish yo‘q",
    metrics: { revenue: "tushum", orders: "buyurtmalar", returning: "qaytgan xaridorlar" },
    min: "daq",
    hour: "soat",
    day: "kun",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number, c: string) => formatMoney(Math.round(n), c);

/** Минуты → «12 мин», «1 ч 30 мин», «2 дн 3 ч». */
export function weeklyDuration(minutes: number, lang: Locale = "ru"): string {
  const w = WORDS[lang];
  const m = Math.round(minutes);
  if (m < 60) return `${m} ${w.min}`;
  if (m < 1440) {
    const rest = m % 60;
    return `${Math.floor(m / 60)} ${w.hour}${rest ? ` ${rest} ${w.min}` : ""}`;
  }
  const h = Math.floor((m % 1440) / 60);
  return `${Math.floor(m / 1440)} ${w.day}${h ? ` ${h} ${w.hour}` : ""}`;
}

function delta(cur: number, prev: number, w: Words): string {
  const d = pctDelta(cur, prev);
  if (d === null || d === 0) return "";
  return ` (${d > 0 ? "▲" : "▼"} ${Math.abs(d)} % ${w.vsPrev})`;
}

/** Текст отчёта (HTML для Telegram) на языке продавца; по умолчанию русский. */
export function renderWeekly(
  label: string,
  s: WeeklyStats,
  lang: Locale = "ru",
  sections: readonly WeeklySection[] = WEEKLY_SECTIONS,
): string {
  const w = WORDS[lang];
  const has = (x: WeeklySection) => sections.includes(x);
  const all = s.funnel[0] ?? { arrived: 0, cart: 0, ordered: 0, paid: 0 };
  const lines = [
    w.title(label),
    "",
    `${w.revenue}: ${money(s.revenue, s.currency)}${delta(s.revenue, s.prevRevenue, w)}`,
    `${w.orders}: ${s.orders}${delta(s.orders, s.prevOrders, w)}`,
  ];
  const sp = s.speed;
  if (has("speed") && sp && sp.payMedian !== null && sp.payP90 !== null)
    lines.push(
      w.speed(
        weeklyDuration(sp.payMedian, lang),
        weeklyDuration(sp.payP90, lang),
        sp.deliverMedian === null ? null : weeklyDuration(sp.deliverMedian, lang),
      ),
    );
  if (has("speed") && sp && sp.autoShare !== null) lines.push(w.auto(sp.autoShare));
  if (has("buyers") && s.buyers) lines.push(w.returning(s.buyers.returning, s.buyers.fresh));
  const change = weeklyChange(s);
  lines.push(
    change
      ? w.changed(w.metrics[change.metric], change.pct > 0 ? "▲" : "▼", Math.abs(change.pct))
      : w.calm,
  );
  if (has("funnel")) {
    lines.push("", `<b>${w.funnel}</b>`);
    FUNNEL_STAGES.forEach((st, i) => {
      const rate = i ? stageRate(all[FUNNEL_STAGES[i - 1]!], all[st]) : null;
      lines.push(`${w.stages[st]}: ${all[st]}${rate === null ? "" : ` (${rate} %)`}`);
    });
    const best = s.funnel.slice(1).sort((a, b) => b.paid - a.paid || b.ordered - a.ordered)[0];
    if (best && best.paid > 0)
      lines.push("", w.bestChannel(w.channels[best.channel] ?? esc(best.channel), best.paid));
  }
  if (has("top") && s.top.length) {
    lines.push("", `<b>${w.top}</b>`);
    s.top.slice(0, 3).forEach((p, i) => lines.push(`${i + 1}. ${esc(p.name)} — ${w.qty(p.qty)}`));
  }
  lines.push("", w.footer);
  return lines.join("\n");
}
