import type { Locale } from "@/core/i18n/locale";
import { lessonFromMessage } from "@/core/courses/lesson-by-bot";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import type { TelegramMessage } from "./types";

/**
 * Урок сообщением боту (settings.delivery.lessons_by_bot, по умолчанию
 * выключено): продавец магазина присылает своему боту в личку ссылку на
 * видео с подписью «1.2 Материалы» — урок добавляется в конец курса. Один
 * курс — сразу; несколько — бот спрашивает кнопками, куда (`lbb:<товар>`,
 * ссылку берёт из сообщения, на которое ответил). Покупателей не касается:
 * проверка — по списку продавцов магазина (`shopAdminIds`).
 */
const COPY = {
  ru: {
    added: (no: number, title: string, course: string) =>
      `✅ Урок ${no} «${title}» добавлен в курс «${course}».`,
    again: "Этот урок уже есть в курсе — второй раз не добавляю.",
    which: "В какой курс добавить урок?",
    none: "Курсов с уроками пока нет: создайте курс в панели, потом присылайте уроки сюда.",
    full: "В курсе уже 100 уроков — больше добавить нельзя.",
    fallback: (no: number) => `Урок ${no}`,
  },
  kk: {
    added: (no: number, title: string, course: string) =>
      `✅ ${no}-сабақ «${title}» «${course}» курсына қосылды.`,
    again: "Бұл сабақ курста бар — екінші рет қоспаймын.",
    which: "Сабақты қай курсқа қосу керек?",
    none: "Сабақтары бар курс әзірге жоқ: панельде курс құрыңыз, содан кейін сабақтарды осында жіберіңіз.",
    full: "Курста 100 сабақ бар — бұдан артық қосуға болмайды.",
    fallback: (no: number) => `${no}-сабақ`,
  },
  en: {
    added: (no: number, title: string, course: string) =>
      `✅ Lesson ${no} “${title}” added to “${course}”.`,
    again: "This lesson is already in the course — not adding it twice.",
    which: "Which course should the lesson go to?",
    none: "No courses with lessons yet: create a course in the panel, then send lessons here.",
    full: "The course already has 100 lessons — no more can be added.",
    fallback: (no: number) => `Lesson ${no}`,
  },
  uz: {
    added: (no: number, title: string, course: string) =>
      `✅ ${no}-dars «${title}» «${course}» kursiga qo‘shildi.`,
    again: "Bu dars kursda bor — ikkinchi marta qo‘shmayman.",
    which: "Darsni qaysi kursga qo‘shay?",
    none: "Darslari bor kurs hozircha yo‘q: panelda kurs yarating, keyin darslarni shu yerga yuboring.",
    full: "Kursda allaqachon 100 ta dars bor — boshqa qo‘shib bo‘lmaydi.",
    fallback: (no: number) => `${no}-dars`,
  },
} as const satisfies Record<Locale, unknown>;

const copyOf = (ctx: TenantContext) => COPY[ctx.tenant.settings.default_locale ?? "ru"] ?? COPY.ru;

async function isSeller(ctx: TenantContext, fromId: number): Promise<boolean> {
  const { shopAdminIds } = await import("@/core/notify/recipients");
  return (await shopAdminIds(ctx)).includes(String(fromId));
}

const on = (ctx: TenantContext) =>
  Boolean(ctx.tenant.modules.courses && ctx.tenant.settings.delivery?.lessons_by_bot);

/** Сообщение продавца со ссылкой — урок. false — это не урок, дальше обычный путь. */
export async function lessonBySeller(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  if (!on(ctx) || !msg.from || msg.chat.id !== msg.from.id || msg.reply_to_message) return false;
  const lesson = lessonFromMessage(msg.text ?? msg.caption);
  if (!lesson || !(await isSeller(ctx, msg.from.id))) return false;
  const c = copyOf(ctx);
  const say = (text: string, extra: Record<string, unknown> = {}) =>
    api.call("sendMessage", { chat_id: msg.chat.id, text, ...extra });
  const { lessonCourses } = await import("@/core/courses/lesson-by-bot.server");
  const courses = await lessonCourses(ctx);
  if (courses.length === 0) {
    await say(c.none);
    return true;
  }
  if (courses.length === 1) {
    await addTo(ctx, courses[0]!, lesson, say);
    return true;
  }
  await say(c.which, {
    reply_parameters: { message_id: msg.message_id },
    reply_markup: {
      inline_keyboard: courses
        .slice(0, 20)
        .map((p) => [{ text: p.name.slice(0, 60), callback_data: `lbb:${p.id}` }]),
    },
  });
  return true;
}

/** Кнопка «в какой курс»: ссылка — из сообщения продавца, на которое ответил бот. */
export async function lessonCourseButton(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
  original: { text?: string; caption?: string } | undefined,
): Promise<void> {
  if (!on(ctx) || !(await isSeller(ctx, fromId))) return;
  const lesson = lessonFromMessage(original?.text ?? original?.caption);
  const productId = data.slice(4);
  const { lessonCourses } = await import("@/core/courses/lesson-by-bot.server");
  const course = (await lessonCourses(ctx)).find((p) => p.id === productId);
  if (!lesson || !course) return;
  await addTo(ctx, course, lesson, (text) => api.call("sendMessage", { chat_id: chatId, text }));
}

async function addTo(
  ctx: TenantContext,
  course: { id: string; name: string },
  lesson: { title: string; link: string },
  say: (text: string) => Promise<unknown>,
) {
  const c = copyOf(ctx);
  const { addLessonByBot } = await import("@/core/courses/lesson-by-bot.server");
  const r = await addLessonByBot(ctx, course.id, lesson, c.fallback);
  if (!r.ok) {
    await say(r.reason === "full" ? c.full : c.again);
    return;
  }
  await say(c.added(r.no, lesson.title || c.fallback(r.no), course.name));
}
