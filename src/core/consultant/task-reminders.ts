import type { Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, updateSettingAtomic, updateSettingStamped } from "@/core/settings/settings";
import { todayInTz } from "@/core/fulfillment/pure";
import { hourIn, isOffHours, pricelistHours } from "@/core/consultant/pricelist/mode";
import { loadTasks, parseTasks, TASKS_KEY, type ConsultantTask } from "./tasks";

/**
 * Напоминания продавцу о задачах консультанта (передачи менеджеру, которые
 * никто не разобрал; у BOVI на 09.10 открыты 10 из 11). Крон health, раз в
 * 15 минут, только клиенты v2 с консультантом по прайсу:
 *
 * - задача открыта 2 ч — одно напоминание в Telegram (несколько задач — одним
 *   сообщением); в нерабочие часы консультанта ждём утра;
 * - в 9:00 по поясу магазина — список всех открытых задач, один раз в день.
 *
 * «Один раз» — отметка `remindedAt` на задаче ставится условной записью
 * списка (updateSettingStamped, условие на `updated_at`), и только выигравший
 * запись шлёт сообщение. Утренний список отмечает показанные задачи тоже —
 * днём о них второй раз не напоминаем. Выключатель — на странице «Прайс
 * консультанта», по умолчанию включено.
 */
export const TASK_REMINDERS_KEY = "consultant_task_reminders";
export const MORNING_SENT_KEY = "consultant_tasks_morning_sent";
export const REMIND_AFTER_MS = 2 * 3600_000;
/** Старше суток — уже не «через 2 часа»: такие задачи приходят утренним списком. */
export const REMIND_MAX_AGE_MS = 24 * 3600_000;
export const MORNING_HOUR = 9;
/** Задач в одном напоминании; остальные — следующим проходом крона. */
export const REMIND_BATCH = 10;
/** Строк в утреннем списке (предел длины сообщения Telegram); остальные — числом и ссылкой. */
export const MORNING_LINES = 15;

/** Выключено, только если продавец снял галочку. */
export function remindersOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "off";
}

/** Пора напомнить: открыта, не напоминали, ждёт от 2 ч до суток. */
export function dueForReminder(tasks: readonly ConsultantTask[], now: Date): ConsultantTask[] {
  const t = now.getTime();
  return tasks
    .filter((x) => {
      if (x.done || x.remindedAt) return false;
      const age = t - Date.parse(x.at);
      return age >= REMIND_AFTER_MS && age <= REMIND_MAX_AGE_MS;
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

type Words = {
  reason: Record<string, string>;
  otherReason: string;
  remindTitle: (n: number) => string;
  morningTitle: (n: number) => string;
  waits: (w: string) => string;
  dialog: string;
  more: (n: number) => string;
  open: string;
  h: string;
  d: string;
  min: string;
};

const WORDS: Record<Locale, Words> = {
  ru: {
    reason: {
      purchase: "Готов купить",
      wholesale: "Опт",
      complaint: "Жалоба или возврат",
      human_requested: "Просит человека",
      photo: "Просит фото или видео",
      unknown_question: "Вопрос без ответа",
    },
    otherReason: "Передача менеджеру",
    remindTitle: (n) =>
      n === 1 ? "⏰ Задача консультанта ждёт ответа" : `⏰ Задачи консультанта ждут ответа: ${n}`,
    morningTitle: (n) => `☀️ Не разобрано задач консультанта: ${n}`,
    waits: (w) => `ждёт ${w}`,
    dialog: "открыть диалог",
    more: (n) => `…и ещё ${n}`,
    open: "Все задачи — «Прайс консультанта»",
    h: "ч",
    d: "дн",
    min: "мин",
  },
  kk: {
    reason: {
      purchase: "Сатып алуға дайын",
      wholesale: "Көтерме",
      complaint: "Шағым немесе қайтару",
      human_requested: "Адамды сұрайды",
      photo: "Фото немесе видео сұрайды",
      unknown_question: "Жауабы жоқ сұрақ",
    },
    otherReason: "Менеджерге берілді",
    remindTitle: (n) =>
      n === 1 ? "⏰ Кеңесші тапсырмасы жауап күтуде" : `⏰ Кеңесші тапсырмалары жауап күтуде: ${n}`,
    morningTitle: (n) => `☀️ Қаралмаған кеңесші тапсырмалары: ${n}`,
    waits: (w) => `${w} күтуде`,
    dialog: "диалогты ашу",
    more: (n) => `…тағы ${n}`,
    open: "Барлық тапсырма — «Кеңесші прайсы»",
    h: "сағ",
    d: "күн",
    min: "мин",
  },
  en: {
    reason: {
      purchase: "Ready to buy",
      wholesale: "Wholesale",
      complaint: "Complaint or return",
      human_requested: "Asks for a human",
      photo: "Asks for a photo or video",
      unknown_question: "Unanswered question",
    },
    otherReason: "Handed to a manager",
    remindTitle: (n) =>
      n === 1 ? "⏰ A consultant task is waiting" : `⏰ Consultant tasks are waiting: ${n}`,
    morningTitle: (n) => `☀️ Open consultant tasks: ${n}`,
    waits: (w) => `waiting ${w}`,
    dialog: "open chat",
    more: (n) => `…and ${n} more`,
    open: "All tasks: “Consultant price list”",
    h: "h",
    d: "d",
    min: "min",
  },
  uz: {
    reason: {
      purchase: "Sotib olishga tayyor",
      wholesale: "Ulgurji",
      complaint: "Shikoyat yoki qaytarish",
      human_requested: "Odamni so‘raydi",
      photo: "Rasm yoki video so‘raydi",
      unknown_question: "Javobsiz savol",
    },
    otherReason: "Menejerga berildi",
    remindTitle: (n) =>
      n === 1
        ? "⏰ Maslahatchi vazifasi javob kutmoqda"
        : `⏰ Maslahatchi vazifalari javob kutmoqda: ${n}`,
    morningTitle: (n) => `☀️ Ko‘rilmagan maslahatchi vazifalari: ${n}`,
    waits: (w) => `${w} kutmoqda`,
    dialog: "suhbatni ochish",
    more: (n) => `…yana ${n} ta`,
    open: "Barcha vazifalar — «Maslahatchi narxlari»",
    h: "soat",
    d: "kun",
    min: "daq",
  },
};

/** «2 ч», «3 дн», «40 мин» — сколько задача открыта. */
export function ageText(locale: Locale, at: string, now: Date): string {
  const w = WORDS[locale];
  const min = Math.max(1, Math.floor((now.getTime() - Date.parse(at)) / 60_000));
  if (min < 60) return `${min} ${w.min}`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} ${w.h}` : `${Math.floor(h / 24)} ${w.d}`;
}

/** Строка о задаче: кто, зачем, сколько ждёт, суть, ссылка на диалог. */
function taskLine(locale: Locale, t: ConsultantTask, now: Date, textMax: number): string {
  const w = WORDS[locale];
  const who = esc(cut(t.name || t.contact || t.userKey, 60));
  const reason = w.reason[t.reason] ?? w.otherReason;
  const text = t.text.trim() ? `\n${esc(cut(t.text.trim().replace(/\s+/g, " "), textMax))}` : "";
  const link = t.link ? ` · <a href="${esc(t.link)}">${w.dialog}</a>` : "";
  return `• <b>${who}</b> — ${esc(reason)}, ${w.waits(ageText(locale, t.at, now))}${link}${text}`;
}

const pageLink = (locale: Locale, appUrl: string) =>
  `<a href="${esc(`${appUrl.replace(/\/$/, "")}/admin/pricelist`)}">${WORDS[locale].open}</a>`;

export function renderReminder(
  locale: Locale,
  tasks: readonly ConsultantTask[],
  now: Date,
  appUrl: string,
): string {
  return [
    `<b>${WORDS[locale].remindTitle(tasks.length)}</b>`,
    "",
    ...tasks.map((t) => taskLine(locale, t, now, 200)),
    "",
    pageLink(locale, appUrl),
  ].join("\n");
}

/** Утренний список: все открытые (давние первыми), до MORNING_LINES строк и число остальных. */
export function renderMorningList(
  locale: Locale,
  open: readonly ConsultantTask[],
  now: Date,
  appUrl: string,
): string {
  const oldest = [...open].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const shown = oldest.slice(0, MORNING_LINES);
  const rest = oldest.length - shown.length;
  return [
    `<b>${WORDS[locale].morningTitle(open.length)}</b>`,
    "",
    ...shown.map((t) => taskLine(locale, t, now, 120)),
    ...(rest > 0 ? [WORDS[locale].more(rest)] : []),
    "",
    pageLink(locale, appUrl),
  ].join("\n");
}

/** Отправка продавцу (Telegram): сколько адресатов получили. */
export type NotifySeller = (
  ctx: TenantContext,
  html: string,
  kind: "question" | "digest",
) => Promise<number>;

/**
 * Отметить задачи «напомнили» условной записью списка. Выбор — внутри записи,
 * по свежему списку: задачу, которую за эту секунду закрыли или отметил
 * соседний крон, не берём. Возвращает отмеченные (пусто — ничего не слать).
 */
async function claimReminded(
  ctx: TenantContext,
  pick: (list: ConsultantTask[]) => ConsultantTask[],
  now: Date,
): Promise<ConsultantTask[]> {
  let claimed: ConsultantTask[] = [];
  const res = await updateSettingStamped(ctx, TASKS_KEY, (raw) => {
    const list = parseTasks(raw);
    claimed = pick(list);
    if (!claimed.length) return null;
    const ids = new Set(claimed.map((t) => t.id));
    const stamp = now.toISOString();
    return JSON.stringify(list.map((t) => (ids.has(t.id) ? { ...t, remindedAt: stamp } : t)));
  });
  return res === "written" ? claimed : [];
}

export async function sendTaskReminders(
  ctx: TenantContext,
  locale: Locale,
  notify: NotifySeller,
  now = new Date(),
): Promise<{ sent: number; skipped?: string }> {
  if (!remindersOn(await getSetting(ctx, TASK_REMINDERS_KEY))) return { sent: 0, skipped: "off" };
  if (isOffHours(now, pricelistHours(ctx.tenant), ctx.timezone))
    return { sent: 0, skipped: "off_hours" };
  const claimed = await claimReminded(
    ctx,
    (list) => dueForReminder(list, now).slice(0, REMIND_BATCH),
    now,
  );
  if (!claimed.length) return { sent: 0 };
  // Отметка уже стоит: сбой отправки не повторяем (могло дойти), задача — в утреннем списке.
  await notify(ctx, renderReminder(locale, claimed, now, ctx.appUrl), "question").catch(
    (e: unknown) => console.warn(`[tasks:${ctx.tenant.id}] напоминание не ушло: ${String(e)}`),
  );
  return { sent: claimed.length };
}

/**
 * Утренний список открытых задач: после 9:00 по поясу магазина, один раз в
 * день. День отмечается условной записью до отправки — из двух кронов список
 * шлёт один. Открытых нет — день отмечен, сообщения нет.
 */
export async function sendMorningTaskList(
  ctx: TenantContext,
  locale: Locale,
  notify: NotifySeller,
  now = new Date(),
): Promise<{ sent: number; skipped?: string }> {
  if (!remindersOn(await getSetting(ctx, TASK_REMINDERS_KEY))) return { sent: 0, skipped: "off" };
  if (hourIn(now, ctx.timezone) < MORNING_HOUR) return { sent: 0, skipped: "early" };
  const day = todayInTz(ctx.timezone, now);
  if ((await getSetting(ctx, MORNING_SENT_KEY)) === day) return { sent: 0, skipped: "already" };
  // Сначала список (сбой чтения — ошибка крона, день не отмечен), потом отметка дня.
  const open = (await loadTasks(ctx)).filter((t) => !t.done);
  const claim = await updateSettingAtomic(ctx, MORNING_SENT_KEY, (raw) =>
    raw === day ? null : day,
  );
  if (claim !== "written") return { sent: 0, skipped: "already" };
  if (!open.length) return { sent: 0, skipped: "empty" };
  // Показанные утром днём второй раз не напоминаем: отметка — условной записью списка.
  const shown = new Set(open.map((t) => t.id));
  await claimReminded(
    ctx,
    (list) => list.filter((t) => shown.has(t.id) && !t.done && !t.remindedAt),
    now,
  );
  await notify(ctx, renderMorningList(locale, open, now, ctx.appUrl), "digest").catch(
    (e: unknown) => console.warn(`[tasks:${ctx.tenant.id}] утренний список не ушёл: ${String(e)}`),
  );
  return { sent: open.length };
}
