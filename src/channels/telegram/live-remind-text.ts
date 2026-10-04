import type { Locale } from "@/core/i18n/locale";
import type { LiveReminder } from "@/core/courses/live-remind.server";
import { COPY, escapeHtml } from "./copy";

/**
 * Сообщение-напоминание об эфире на языке ученика. Название и время идут как
 * текст (HTML экранируется); время эфира — как задал продавец, без пересчёта.
 * Кнопка «Войти на эфир» — только у напоминания за час и только если ссылка
 * есть; «Открыть курс» — если у магазина есть адрес витрины.
 */
export function liveReminderMessage(x: LiveReminder, locale: Locale) {
  const m = COPY[locale] ?? COPY.ru;
  const when = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${x.at}:00Z`));
  const text = (x.kind === "hour" ? m.courseLiveHour : m.courseLiveDay)(x.course, x.title, when);
  const buttons = [
    x.kind === "hour" && x.link ? { text: m.courseLiveJoinBtn, url: x.link } : null,
    x.url ? { text: m.courseOpenBtn, url: x.url } : null,
  ];
  return {
    text: escapeHtml(text),
    rows: buttons.flatMap((b) => (b ? [[b]] : [])),
  };
}
