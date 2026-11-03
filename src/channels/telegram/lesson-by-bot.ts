import type { Locale } from "@/core/i18n/locale";
import { lessonFromMessage, videoLessonFromMessage } from "@/core/courses/lesson-by-bot";
import type { BotLesson } from "@/core/courses/lesson-by-bot.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import type { TelegramMessage } from "./types";

/**
 * Урок сообщением боту (settings.delivery.lessons_by_bot, по умолчанию
 * выключено): продавец магазина присылает своему боту в личку ссылку на
 * видео или само видео с подписью «1.2 Материалы» — урок добавляется в конец
 * курса; видео с той же подписью подряд — в тот же урок. Видео файлом бот
 * потом шлёт ученице по file_id (`sendVideo`), у нас оно не хранится. Один
 * курс — сразу; несколько — бот спрашивает кнопками, куда (`lbb:<товар>`,
 * ссылку берёт из сообщения, на которое ответил). Покупателей не касается:
 * проверка — по списку продавцов магазина (`shopAdminIds`).
 */
const COPY = {
  ru: {
    added: (no: number, title: string, course: string) =>
      `✅ Новый урок ${no} «${title}» в курсе «${course}».`,
    appended: (no: number, title: string, course: string) =>
      `✅ Видео добавлено в урок ${no} «${title}» (курс «${course}»).`,
    where: (no: number) =>
      `Ученицы увидят его в боте: «🎓 Мои курсы» → урок ${no}. Видео придёт им прямо в чат, переслать его нельзя.`,
    tip: "Подсказка: в подписи пишите номер урока, например «1.1», — видео попадёт в этот урок. Подпись без номера — новый урок в конце курса.",
    view: "👁 Посмотреть урок",
    remove: "🗑 Убрать это видео",
    removed: (no: number) => `Видео убрано из урока ${no}.`,
    lessonRemoved: (no: number) => `Урок ${no} убран: в нём не осталось материалов.`,
    gone: "Этого видео в уроке уже нет.",
    again: "Это видео уже есть в курсе — второй раз не добавляю.",
    which: "В какой курс добавить урок?",
    none: "Курсов с уроками пока нет: создайте курс в панели, потом присылайте уроки сюда.",
    full: "В курсе уже 100 уроков — больше добавить нельзя.",
    videosFull: "В уроке уже 10 видео — больше добавить нельзя.",
    fallback: (no: number) => `Урок ${no}`,
  },
  kk: {
    added: (no: number, title: string, course: string) =>
      `✅ «${course}» курсында жаңа ${no}-сабақ «${title}».`,
    appended: (no: number, title: string, course: string) =>
      `✅ Бейне ${no}-сабаққа «${title}» қосылды («${course}» курсы).`,
    where: (no: number) =>
      `Оқушылар оны ботта көреді: «🎓 Менің курстарым» → ${no}-сабақ. Бейне оларға тікелей чатқа келеді, оны бөлісуге болмайды.`,
    tip: "Кеңес: жазуда сабақ нөмірін жазыңыз, мысалы «1.1», — бейне сол сабаққа түседі. Нөмірсіз жазу — курстың соңында жаңа сабақ.",
    view: "👁 Сабақты көру",
    remove: "🗑 Бұл бейнені алып тастау",
    removed: (no: number) => `Бейне ${no}-сабақтан алынды.`,
    lessonRemoved: (no: number) => `${no}-сабақ алынды: онда материал қалмады.`,
    gone: "Бұл бейне сабақта енді жоқ.",
    again: "Бұл бейне курста бар — екінші рет қоспаймын.",
    which: "Сабақты қай курсқа қосу керек?",
    none: "Сабақтары бар курс әзірге жоқ: панельде курс құрыңыз, содан кейін сабақтарды осында жіберіңіз.",
    full: "Курста 100 сабақ бар — бұдан артық қосуға болмайды.",
    videosFull: "Сабақта 10 бейне бар — бұдан артық қосуға болмайды.",
    fallback: (no: number) => `${no}-сабақ`,
  },
  en: {
    added: (no: number, title: string, course: string) =>
      `✅ New lesson ${no} “${title}” in “${course}”.`,
    appended: (no: number, title: string, course: string) =>
      `✅ Video added to lesson ${no} “${title}” (course “${course}”).`,
    where: (no: number) =>
      `Students will see it in the bot: “🎓 My courses” → lesson ${no}. The video comes right into their chat and can’t be forwarded.`,
    tip: "Tip: put the lesson number in the caption, e.g. “1.1”, and the video goes into that lesson. A caption without a number makes a new lesson at the end.",
    view: "👁 View lesson",
    remove: "🗑 Remove this video",
    removed: (no: number) => `Video removed from lesson ${no}.`,
    lessonRemoved: (no: number) => `Lesson ${no} removed: nothing was left in it.`,
    gone: "This video is no longer in the lesson.",
    again: "This video is already in the course — not adding it twice.",
    which: "Which course should the lesson go to?",
    none: "No courses with lessons yet: create a course in the panel, then send lessons here.",
    full: "The course already has 100 lessons — no more can be added.",
    videosFull: "The lesson already has 10 videos — no more can be added.",
    fallback: (no: number) => `Lesson ${no}`,
  },
  uz: {
    added: (no: number, title: string, course: string) =>
      `✅ «${course}» kursida yangi ${no}-dars «${title}».`,
    appended: (no: number, title: string, course: string) =>
      `✅ Video ${no}-darsga «${title}» qo‘shildi («${course}» kursi).`,
    where: (no: number) =>
      `O‘quvchilar uni botda ko‘radi: «🎓 Kurslarim» → ${no}-dars. Video ularga to‘g‘ridan-to‘g‘ri chatga keladi, uni ulashib bo‘lmaydi.`,
    tip: "Maslahat: izohda dars raqamini yozing, masalan «1.1», — video shu darsga tushadi. Raqamsiz izoh — kurs oxirida yangi dars.",
    view: "👁 Darsni ko‘rish",
    remove: "🗑 Bu videoni olib tashlash",
    removed: (no: number) => `Video ${no}-darsdan olib tashlandi.`,
    lessonRemoved: (no: number) => `${no}-dars olib tashlandi: unda material qolmadi.`,
    gone: "Bu video darsda endi yo‘q.",
    again: "Bu video kursda bor — ikkinchi marta qo‘shmayman.",
    which: "Darsni qaysi kursga qo‘shay?",
    none: "Darslari bor kurs hozircha yo‘q: panelda kurs yarating, keyin darslarni shu yerga yuboring.",
    full: "Kursda allaqachon 100 ta dars bor — boshqa qo‘shib bo‘lmaydi.",
    videosFull: "Darsda allaqachon 10 ta video bor — boshqa qo‘shib bo‘lmaydi.",
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
  const lesson = sellerLesson(msg);
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
  // Номер урока из подписи есть только в одном курсе — спрашивать нечего.
  const { coursesWithNumber } = await import("@/core/courses/lesson-by-bot.server");
  const byNumber = await coursesWithNumber(ctx, courses, lesson.title);
  if (byNumber.length === 1) {
    await addTo(ctx, byNumber[0]!, lesson, say);
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
  original: Parameters<typeof sellerLesson>[0] | undefined,
): Promise<void> {
  if (!on(ctx) || !(await isSeller(ctx, fromId))) return;
  const lesson = original ? sellerLesson(original) : null;
  const productId = data.slice(4);
  const { lessonCourses } = await import("@/core/courses/lesson-by-bot.server");
  const course = (await lessonCourses(ctx)).find((p) => p.id === productId);
  if (!lesson || !course) return;
  await addTo(ctx, course, lesson, (text, extra = {}) =>
    api.call("sendMessage", { chat_id: chatId, text, ...extra }),
  );
}

async function addTo(
  ctx: TenantContext,
  course: { id: string; name: string },
  lesson: BotLesson,
  say: (text: string, extra?: Record<string, unknown>) => Promise<unknown>,
) {
  const c = copyOf(ctx);
  const { addLessonByBot } = await import("@/core/courses/lesson-by-bot.server");
  const r = await addLessonByBot(ctx, course.id, lesson, c.fallback);
  if (!r.ok) {
    await say(r.reason === "full" ? c.full : r.reason === "videosFull" ? c.videosFull : c.again);
    return;
  }
  const rows = [[{ text: c.view, callback_data: `lbv:${course.id}:${r.no}` }]];
  if (r.video !== undefined && lesson.tgVideo)
    rows.push([
      {
        text: c.remove,
        callback_data: `lbd:${course.id}:${r.no}:${r.video}:${lesson.tgVideo.slice(-VIDEO_TAIL)}`,
      },
    ]);
  await say(
    [(r.appended ? c.appended : c.added)(r.no, r.title, course.name), c.where(r.no), c.tip].join(
      "\n\n",
    ),
    { reply_markup: { inline_keyboard: rows } },
  );
}

/** Хвост file_id в кнопке «Убрать»: уроки могли сдвинуться — убираем только то самое видео. */
const VIDEO_TAIL = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «👁 Посмотреть урок» (`lbv:<товар>:<номер>`) и «🗑 Убрать это видео»
 * (`lbd:<товар>:<номер>:<видео>`) под ответом продавцу. Только продавец.
 */
export async function lessonSellerButton(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
): Promise<void> {
  if (!on(ctx) || !(await isSeller(ctx, fromId))) return;
  const [kind, productId = "", noRaw = "", videoRaw = "", tail = ""] = data.split(":");
  const no = Number(noRaw);
  if (!UUID_RE.test(productId) || !Number.isInteger(no) || no < 1) return;
  const c = copyOf(ctx);
  const say = (text: string, extra: Record<string, unknown> = {}) =>
    api.call("sendMessage", { chat_id: chatId, text, ...extra });
  const { getCourse } = await import("@/core/courses/course.server");
  if (kind === "lbd") {
    const video = Number(videoRaw);
    if (!Number.isInteger(video) || video < 0 || tail.length !== VIDEO_TAIL) return;
    const before = (await getCourse(ctx, productId)).lessons.length;
    const { removeBotVideo } = await import("@/core/courses/lesson-by-bot.server");
    if (!(await removeBotVideo(ctx, productId, no, video, tail))) return void (await say(c.gone));
    const after = (await getCourse(ctx, productId)).lessons.length;
    await say(after < before ? c.lessonRemoved(no) : c.removed(no));
    return;
  }
  const l = (await getCourse(ctx, productId)).lessons[no - 1];
  if (!l) return void (await say(c.gone));
  const { lessonLinks } = await import("@/core/courses/course");
  for (const [i, video] of (l.tgVideos ?? []).entries())
    await api.call("sendVideo", {
      chat_id: chatId,
      video,
      caption: `🎬 ${no}. ${l.title}${(l.tgVideos?.length ?? 0) > 1 ? ` · ${i + 1}` : ""}`.slice(
        0,
        1024,
      ),
      protect_content: true,
    });
  const links = lessonLinks(l);
  await say(`📖 ${no}. ${l.title}${l.text ? `\n\n${l.text}` : ""}`.slice(0, 4096), {
    ...(links.length
      ? {
          reply_markup: {
            inline_keyboard: links.map((url, i) => [
              { text: `▶️ ${links.length > 1 ? `${i + 1}. ` : ""}${l.title}`.slice(0, 60), url },
            ]),
          },
        }
      : {}),
  });
}

/** Видео файлом с подписью или ссылка с подписью — урок; иначе null. */
function sellerLesson(m: {
  text?: string;
  caption?: string;
  video?: { file_id: string };
  document?: { file_id: string; mime_type?: string };
}): BotLesson | null {
  return videoLessonFromMessage(m) ?? lessonFromMessage(m.text ?? m.caption);
}
