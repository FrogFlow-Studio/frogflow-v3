/**
 * Быстрые ответы куратора к домашним заданиям (ниша «Онлайн-школа»): шаблоны
 * комментариев в `bots.settings.homework_replies`. В админке шаблон одним
 * нажатием попадает в поле комментария; в Telegram куратор отвечает свайпом
 * на уведомление о работе: `#` — список, `#2` — шаблон №2 (можно дописать
 * свои слова после номера). Чистый модуль: читает и браузер.
 */
import type { HomeworkReply } from "@/core/tenant/types";

export const HW_REPLIES_MAX = 20;
export const HW_REPLY_TITLE_MAX = 60;
export const HW_REPLY_TEXT_MAX = 1000;
/** Комментарий к работе целиком (шаблон + свои слова) не длиннее, чем принимает проверка. */
export const HW_COMMENT_MAX = 4000;

/** Пустые выкидываем, длины режем, не больше HW_REPLIES_MAX; название по умолчанию — начало текста. */
export function parseHwReplies(raw: unknown): HomeworkReply[] {
  const out: HomeworkReply[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim().slice(0, HW_REPLY_TEXT_MAX) : "";
    if (!text) continue;
    const title =
      (typeof o.title === "string" ? o.title.trim().slice(0, HW_REPLY_TITLE_MAX) : "") ||
      text.split("\n")[0]!.slice(0, 40);
    out.push({ title, text });
    if (out.length >= HW_REPLIES_MAX) break;
  }
  return out;
}

/** Подстановка {name} — имя ученика (первое слово); без имени «Молодец, {name}!» → «Молодец!». */
export function fillHwReply(text: string, student: string | null | undefined): string {
  const name = student?.trim().split(/\s+/)[0];
  return name
    ? text.replace(/\{name\}/g, name)
    : text.replace(/,[ \t]*\{name\}/g, "").replace(/\{name\},?[ \t]*/g, "");
}

export type HwReplyCommand = { kind: "list" } | { kind: "use"; n: number; extra: string };

/** «#» — список шаблонов; «#2» или «#2 и ещё слова» — шаблон №2 с добавкой. Всё прочее — не команда. */
export function parseHwReplyCommand(text: string): HwReplyCommand | null {
  const m = /^#(?:(\d{1,2})(?:\s+([\s\S]*\S))?)?\s*$/.exec(text.trim());
  if (!m) return null;
  return m[1] ? { kind: "use", n: Number(m[1]), extra: m[2]?.trim() ?? "" } : { kind: "list" };
}

/** Комментарий из шаблона: подставленное имя, затем добавка куратора; null — шаблона с таким номером нет. */
export function hwCommentFromReply(
  replies: readonly HomeworkReply[],
  cmd: Extract<HwReplyCommand, { kind: "use" }>,
  student: string | null | undefined,
): string | null {
  const tpl = replies[cmd.n - 1];
  if (!tpl) return null;
  return [fillHwReply(tpl.text, student), cmd.extra]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, HW_COMMENT_MAX);
}
