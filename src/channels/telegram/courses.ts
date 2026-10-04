import type { Locale } from "@/core/i18n/locale";
import type { Customer } from "@/core/customers/customers";
import { setState } from "@/core/customers/customers";
import {
  HW_FILE_MAX_BYTES,
  HW_MEDIA_MAX_BYTES,
  type HomeworkFile,
  type HomeworkStatus,
} from "@/core/courses/homework";
import type { ChannelInviter } from "@/core/courses/channel.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import { escapeHtml } from "./copy";
import { quizButton } from "./course-quiz";
import type { InlineButton, TelegramMessage } from "./types";

/**
 * Онлайн-школа в боте (модуль courses, docs/COURSES-NICHE.md): «Мои курсы»,
 * сдача домашнего задания прямо в чат (текст, фото, альбом, PDF) и личная
 * ссылка в закрытый канал курса. Правила — в core/courses, здесь разбор
 * сообщения и ответ.
 */
export type CourseBot = {
  ctx: TenantContext;
  api: TelegramApi;
  chatId: number;
  customer: Customer;
  locale: Locale;
};

type Copy = {
  empty: string;
  header: string;
  progress: (open: number, total: number, done: number) => string;
  next: (date: string) => string;
  status: Record<HomeworkStatus | "none", string>;
  hwLine: (no: number, status: string) => string;
  openBtn: string;
  lessonsBtn: string;
  lessonsHeader: string;
  lessonFiles: string;
  submitBtn: (no: number) => string;
  channelBtn: string;
  prompt: (no: number, title: string, task: string) => string;
  sent: string;
  tooLarge: string;
  badFile: string;
  tooManyFiles: string;
  accepted: string;
  closed: string;
  notInTariff: string;
  cohort: (title: string, date: string) => string;
  beforeStart: (date: string) => string;
  expires: (date: string) => string;
  expired: (date: string) => string;
  failed: string;
  inviteReady: string;
  inviteJoin: string;
  inviteBusy: string;
  inviteAlready: string;
  inviteFailed: string;
  chatBtn: string;
  chatReady: string;
  chatAlready: string;
  chatFailed: string;
  livesBtn: string;
  livesHeader: string;
  liveLine: (time: string, title: string, status: "upcoming" | "open" | "past") => string;
  liveJoin: string;
  liveNoLink: string;
  livesEmpty: string;
  liveWatch: string;
};

const COPY: Record<Locale, Copy> = {
  ru: {
    empty: "У вас пока нет курсов.",
    header: "🎓 <b>Ваши курсы</b>",
    progress: (open, total, done) => `Открыто уроков: ${open} из ${total} · пройдено: ${done}`,
    next: (date) => `Следующий урок откроется ${date}`,
    status: {
      none: "ждёт вашего ответа",
      submitted: "на проверке",
      accepted: "принято ✅",
      revise: "вернули на доработку",
    },
    hwLine: (no, status) => `📝 Урок ${no}: ${status}`,
    openBtn: "📖 Открыть уроки",
    lessonsBtn: "📚 Уроки в чате",
    lessonsHeader: "Открытые уроки — выберите:",
    lessonFiles: "Материалы (ссылки действуют сутки):",
    submitBtn: (no) => `📝 Сдать задание — урок ${no}`,
    channelBtn: "🔐 Вступить в канал курса",
    prompt: (no, title, task) =>
      `📝 <b>Урок ${no}. ${title}</b>\n\n${task}\n\n` +
      "Пришлите ответ одним сообщением: текст, фото (можно альбом до 5 фото), PDF, голосовое, видео или «кружок».",
    sent: "✅ Ответ отправлен преподавателю. Когда работа будет проверена, я напишу.",
    tooLarge:
      "Файл слишком большой: фото и PDF — до 3 МБ, голосовое и видео — до 20 МБ. Пришлите фото (Telegram сожмёт его) или запись покороче.",
    badFile: "Этот ответ не подходит: пришлите текст, фото, PDF, голосовое или видео.",
    tooManyFiles: "В одном ответе — не больше 5 файлов.",
    accepted: "Это задание уже принято.",
    closed: "Этот урок ещё не открыт.",
    notInTariff: "Проверка домашних заданий не входит в ваш тариф.",
    cohort: (title, date) => `Поток «${title}» · старт ${date}`,
    beforeStart: (date) => `Курс начнётся ${date}.`,
    expires: (date) => `Доступ открыт до ${date}.`,
    expired: (date) => `Доступ к курсу закончился ${date}.`,
    failed: "Не получилось отправить ответ, попробуйте ещё раз.",
    inviteReady: "🔐 Ваша личная ссылка в канал курса — на одного человека, действует сутки:",
    inviteJoin: "Вступить",
    inviteBusy: "Ссылка уже готовится — нажмите ещё раз через минуту.",
    inviteAlready: "Вы уже в канале курса — найдите его в списке чатов Telegram.",
    inviteFailed: "Не получилось создать ссылку в канал. Напишите преподавателю.",
    chatBtn: "💬 Вступить в чат потока",
    chatReady: "💬 Ваша личная ссылка в чат вашего потока — на одного человека, действует сутки:",
    chatAlready: "Вы уже в чате потока — найдите его в списке чатов Telegram.",
    chatFailed: "Не получилось создать ссылку в чат потока. Напишите преподавателю.",
    livesBtn: "📅 Эфиры",
    livesHeader: "📅 <b>Эфиры потока</b>",
    liveLine: (time, title, status) =>
      `${status === "past" ? "▫️" : "🎥"} ${time} · ${title}` +
      (status === "past"
        ? " — прошёл"
        : status === "upcoming"
          ? " — ссылка появится за 15 минут до начала"
          : ""),
    liveJoin: "🎥 Войти на эфир",
    liveNoLink: "Ссылку на эфир пришлёт школа.",
    livesEmpty:
      "Эфиров по этому курсу сейчас нет: доступ закончился или школа их убрала. Если это ошибка, напишите в школу.",
    liveWatch: "▶️ Смотреть запись",
  },
  kk: {
    empty: "Сізде әзірге курс жоқ.",
    header: "🎓 <b>Сіздің курстарыңыз</b>",
    progress: (open, total, done) => `Ашық сабақтар: ${total} ішінен ${open} · өтілді: ${done}`,
    next: (date) => `Келесі сабақ ${date} ашылады`,
    status: {
      none: "жауабыңызды күтуде",
      submitted: "тексерілуде",
      accepted: "қабылданды ✅",
      revise: "пысықтауға қайтарылды",
    },
    hwLine: (no, status) => `📝 ${no}-сабақ: ${status}`,
    openBtn: "📖 Сабақтарды ашу",
    lessonsBtn: "📚 Сабақтар чатта",
    lessonsHeader: "Ашық сабақтар — таңдаңыз:",
    lessonFiles: "Материалдар (сілтемелер бір тәулік жарамды):",
    submitBtn: (no) => `📝 Тапсырманы тапсыру — ${no}-сабақ`,
    channelBtn: "🔐 Курс арнасына кіру",
    prompt: (no, title, task) =>
      `📝 <b>${no}-сабақ. ${title}</b>\n\n${task}\n\n` +
      "Жауапты бір хабарламамен жіберіңіз: мәтін, фото (5 фотоға дейінгі альбом), PDF, дауыстық хабарлама, бейне немесе «дөңгелек».",
    sent: "✅ Жауап оқытушыға жіберілді. Жұмыс тексерілгенде хабарлаймын.",
    tooLarge:
      "Файл тым үлкен: фото мен PDF — 3 МБ-қа дейін, дауыстық хабарлама мен бейне — 20 МБ-қа дейін. Фото жіберіңіз (Telegram оны сығады) немесе қысқарақ жазба жіберіңіз.",
    badFile: "Бұл жауап жарамайды: мәтін, фото, PDF, дауыстық хабарлама немесе бейне жіберіңіз.",
    tooManyFiles: "Бір жауапта 5 файлдан аспауы керек.",
    accepted: "Бұл тапсырма қабылданып қойған.",
    closed: "Бұл сабақ әлі ашылмаған.",
    notInTariff: "Үй тапсырмаларын тексеру сіздің тарифіңізге кірмейді.",
    cohort: (title, date) => `«${title}» ағыны · басталуы ${date}`,
    beforeStart: (date) => `Курс ${date} басталады.`,
    expires: (date) => `Қолжетімділік ${date} дейін ашық.`,
    expired: (date) => `Курсқа қолжетімділік ${date} аяқталды.`,
    failed: "Жауапты жіберу мүмкін болмады, қайталап көріңіз.",
    inviteReady: "🔐 Курс арнасына жеке сілтемеңіз — бір адамға, бір тәулік жарамды:",
    inviteJoin: "Кіру",
    inviteBusy: "Сілтеме дайындалып жатыр — бір минуттан соң қайта басыңыз.",
    inviteAlready: "Сіз курс арнасындасыз — оны Telegram чаттар тізімінен табыңыз.",
    inviteFailed: "Арнаға сілтеме жасау мүмкін болмады. Оқытушыға жазыңыз.",
    chatBtn: "💬 Ағын чатына кіру",
    chatReady: "💬 Ағыныңыздың чатына жеке сілтемеңіз — бір адамға, бір тәулік жарамды:",
    chatAlready: "Сіз ағын чатындасыз — оны Telegram чаттар тізімінен табыңыз.",
    chatFailed: "Ағын чатына сілтеме жасау мүмкін болмады. Оқытушыға жазыңыз.",
    livesBtn: "📅 Эфирлер",
    livesHeader: "📅 <b>Ағын эфирлері</b>",
    liveLine: (time, title, status) =>
      `${status === "past" ? "▫️" : "🎥"} ${time} · ${title}` +
      (status === "past"
        ? " — өтті"
        : status === "upcoming"
          ? " — сілтеме басталуына 15 минут қалғанда пайда болады"
          : ""),
    liveJoin: "🎥 Эфирге кіру",
    liveNoLink: "Эфирге сілтемені мектеп жібереді.",
    livesEmpty:
      "Бұл курс бойынша қазір эфирлер жоқ: қолжетімділік аяқталды немесе мектеп оларды алып тастады. Қате болса, мектепке жазыңыз.",
    liveWatch: "▶️ Жазбаны көру",
  },
  en: {
    empty: "You don't have any courses yet.",
    header: "🎓 <b>Your courses</b>",
    progress: (open, total, done) => `Lessons open: ${open} of ${total} · completed: ${done}`,
    next: (date) => `The next lesson opens on ${date}`,
    status: {
      none: "waiting for your answer",
      submitted: "under review",
      accepted: "accepted ✅",
      revise: "sent back for revision",
    },
    hwLine: (no, status) => `📝 Lesson ${no}: ${status}`,
    openBtn: "📖 Open lessons",
    lessonsBtn: "📚 Lessons in chat",
    lessonsHeader: "Open lessons — pick one:",
    lessonFiles: "Materials (links work for 24 hours):",
    submitBtn: (no) => `📝 Submit homework — lesson ${no}`,
    channelBtn: "🔐 Join the course channel",
    prompt: (no, title, task) =>
      `📝 <b>Lesson ${no}. ${title}</b>\n\n${task}\n\n` +
      "Send your answer in one message: text, photos (an album of up to 5), a PDF, a voice message, a video or a video note.",
    sent: "✅ Your answer has been sent to the teacher. I'll message you once it's reviewed.",
    tooLarge:
      "The file is too large: photos and PDFs up to 3 MB, voice messages and videos up to 20 MB. Send a photo (Telegram compresses it) or a shorter recording.",
    badFile: "This answer can't be accepted: send text, photos, a PDF, a voice message or a video.",
    tooManyFiles: "No more than 5 files per answer.",
    accepted: "This homework has already been accepted.",
    closed: "This lesson isn't open yet.",
    notInTariff: "Homework review isn't included in your plan.",
    cohort: (title, date) => `Cohort «${title}» · starts ${date}`,
    beforeStart: (date) => `The course starts on ${date}.`,
    expires: (date) => `Access is open until ${date}.`,
    expired: (date) => `Your access to the course ended on ${date}.`,
    failed: "Couldn't send your answer, please try again.",
    inviteReady:
      "🔐 Your personal link to the course channel — for one person, valid for 24 hours:",
    inviteJoin: "Join",
    inviteBusy: "The link is being prepared — tap again in a minute.",
    inviteAlready: "You are already in the course channel — find it in your Telegram chats.",
    inviteFailed: "Couldn't create a link to the channel. Please message the teacher.",
    chatBtn: "💬 Join the cohort chat",
    chatReady: "💬 Your personal link to your cohort’s chat — for one person, valid for 24 hours:",
    chatAlready: "You are already in the cohort chat — find it in your Telegram chats.",
    chatFailed: "Couldn’t create a link to the cohort chat. Please message the teacher.",
    livesBtn: "📅 Live sessions",
    livesHeader: "📅 <b>Cohort live sessions</b>",
    liveLine: (time, title, status) =>
      `${status === "past" ? "▫️" : "🎥"} ${time} · ${title}` +
      (status === "past"
        ? " — finished"
        : status === "upcoming"
          ? " — the link appears 15 minutes before the start"
          : ""),
    liveJoin: "🎥 Join the live session",
    liveNoLink: "The school will send the link.",
    livesEmpty:
      "There are no live sessions for this course right now: your access has ended or the school removed them. If this is a mistake, message the school.",
    liveWatch: "▶️ Watch the recording",
  },
  uz: {
    empty: "Sizda hozircha kurslar yo‘q.",
    header: "🎓 <b>Kurslaringiz</b>",
    progress: (open, total, done) => `Ochiq darslar: ${total} tadan ${open} · o‘tildi: ${done}`,
    next: (date) => `Keyingi dars ${date} kuni ochiladi`,
    status: {
      none: "javobingizni kutmoqda",
      submitted: "tekshirilmoqda",
      accepted: "qabul qilindi ✅",
      revise: "qayta ishlashga qaytarildi",
    },
    hwLine: (no, status) => `📝 ${no}-dars: ${status}`,
    openBtn: "📖 Darslarni ochish",
    lessonsBtn: "📚 Darslar chatda",
    lessonsHeader: "Ochiq darslar — tanlang:",
    lessonFiles: "Materiallar (havolalar bir kun amal qiladi):",
    submitBtn: (no) => `📝 Vazifani topshirish — ${no}-dars`,
    channelBtn: "🔐 Kurs kanaliga qo‘shilish",
    prompt: (no, title, task) =>
      `📝 <b>${no}-dars. ${title}</b>\n\n${task}\n\n` +
      "Javobni bitta xabarda yuboring: matn, rasm (5 tagacha rasmli albom), PDF, ovozli xabar, video yoki «dumaloq video».",
    sent: "✅ Javob o‘qituvchiga yuborildi. Ish tekshirilgach, xabar beraman.",
    tooLarge:
      "Fayl juda katta: rasm va PDF — 3 MB gacha, ovozli xabar va video — 20 MB gacha. Rasm sifatida yuboring (Telegram uni siqadi) yoki qisqaroq yozuv yuboring.",
    badFile: "Bu javob mos emas: matn, rasm, PDF, ovozli xabar yoki video yuboring.",
    tooManyFiles: "Bitta javobda 5 tadan ko‘p fayl bo‘lmasin.",
    accepted: "Bu vazifa allaqachon qabul qilingan.",
    closed: "Bu dars hali ochilmagan.",
    notInTariff: "Uy vazifalarini tekshirish tarifingizga kirmaydi.",
    cohort: (title, date) => `«${title}» oqimi · boshlanishi ${date}`,
    beforeStart: (date) => `Kurs ${date} kuni boshlanadi.`,
    expires: (date) => `Kirish ${date} gacha ochiq.`,
    expired: (date) => `Kursga kirish ${date} kuni tugadi.`,
    failed: "Javobni yuborib bo‘lmadi, qayta urinib ko‘ring.",
    inviteReady: "🔐 Kurs kanaliga shaxsiy havolangiz — bir kishi uchun, bir kun amal qiladi:",
    inviteJoin: "Qo‘shilish",
    inviteBusy: "Havola tayyorlanmoqda — bir daqiqadan so‘ng yana bosing.",
    inviteAlready: "Siz allaqachon kurs kanalidasiz — uni Telegram chatlari ro‘yxatidan toping.",
    inviteFailed: "Kanalga havola yaratib bo‘lmadi. O‘qituvchiga yozing.",
    chatBtn: "💬 Oqim chatiga qo‘shilish",
    chatReady: "💬 Oqimingiz chatiga shaxsiy havolangiz — bir kishi uchun, bir kun amal qiladi:",
    chatAlready: "Siz allaqachon oqim chatidasiz — uni Telegram chatlari ro‘yxatidan toping.",
    chatFailed: "Oqim chatiga havola yaratib bo‘lmadi. O‘qituvchiga yozing.",
    livesBtn: "📅 Efirlar",
    livesHeader: "📅 <b>Oqim efirlari</b>",
    liveLine: (time, title, status) =>
      `${status === "past" ? "▫️" : "🎥"} ${time} · ${title}` +
      (status === "past"
        ? " — o‘tdi"
        : status === "upcoming"
          ? " — havola boshlanishidan 15 daqiqa oldin paydo bo‘ladi"
          : ""),
    liveJoin: "🎥 Efirga kirish",
    liveNoLink: "Havolani maktab yuboradi.",
    livesEmpty:
      "Bu kurs bo'yicha hozir efirlar yo'q: kirish muddati tugagan yoki maktab ularni olib tashlagan. Xato bo'lsa, maktabga yozing.",
    liveWatch: "▶️ Yozuvni ko‘rish",
  },
};

async function send(b: CourseBot, text: string, extra: Record<string, unknown> = {}) {
  await b.api.call("sendMessage", {
    chat_id: b.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

/** Сколько кнопок «Сдать задание» показывать на курс: открытые несданные, по порядку. */
const SUBMIT_BUTTONS_MAX = 3;

// ── «Мои курсы» ───────────────────────────────────────────────────────

export async function showMyCourses(b: CourseBot): Promise<void> {
  const c = COPY[b.locale];
  const { customerCourses } = await import("@/core/courses/mine.server");
  const courses = await customerCourses(b.ctx, b.customer);
  if (courses.length === 0) return send(b, c.empty);
  await send(b, c.header);
  const fmt = new Intl.DateTimeFormat(b.locale, {
    day: "numeric",
    month: "long",
    timeZone: b.ctx.timezone,
  });
  for (const k of courses) {
    const day = (iso: string) => fmt.format(new Date(iso));
    const lines = [`<b>${escapeHtml(k.name)}</b>`];
    if (k.cohort) lines.push(c.cohort(escapeHtml(k.cohort.title), day(k.cohort.start)));
    if (k.beforeStart && k.cohort) lines.push(c.beforeStart(day(k.cohort.start)));
    else lines.push(c.progress(k.open, k.total, k.done));
    if (k.expiresAt) lines.push((k.expired ? c.expired : c.expires)(day(k.expiresAt)));
    if (k.nextAt && !k.beforeStart) lines.push(c.next(day(k.nextAt)));
    for (const h of k.homework) lines.push(c.hwLine(h.lessonNo, c.status[h.status ?? "none"]));
    const rows: InlineButton[][] = [];
    if (k.url) rows.push([{ text: c.openBtn, url: k.url }]);
    if (k.open > 0) rows.push([{ text: c.lessonsBtn, callback_data: `lsl:${k.orderItemId}` }]);
    for (const h of k.homework
      .filter((h) => k.canSubmit && (h.status === null || h.status === "revise"))
      .slice(0, SUBMIT_BUTTONS_MAX))
      rows.push([
        { text: c.submitBtn(h.lessonNo), callback_data: `hw:${k.orderItemId}:${h.lessonNo}` },
      ]);
    if (k.channel) rows.push([{ text: c.channelBtn, callback_data: `cinv:${k.orderItemId}` }]);
    if (k.chat) rows.push([{ text: c.chatBtn, callback_data: `cchat:${k.orderItemId}` }]);
    if (k.lives) rows.push([{ text: c.livesBtn, callback_data: `lv:${k.orderItemId}` }]);
    await send(b, lines.join("\n"), rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
  }
}

// ── сдача задания ────────────────────────────────────────────────────

/** Своя выданная покупка-курс: чужая или подделанная кнопка — null. */
async function ownPurchase(b: CourseBot, orderItemId: string) {
  const { coursePurchase } = await import("@/core/courses/run.server");
  const p = await coursePurchase(b.ctx, orderItemId);
  return p && p.telegramId === b.customer.telegramId ? p : null;
}

/** Кнопка «Сдать задание — урок N»: показать задание и ждать ответ. */
export async function startHomework(b: CourseBot, data: string): Promise<void> {
  const c = COPY[b.locale];
  const [, itemId = "", noRaw = ""] = data.split(":");
  const p = await ownPurchase(b, itemId);
  if (!p) return;
  const { purchaseTimeline } = await import("@/core/courses/run.server");
  const tl = purchaseTimeline(b.ctx, p);
  const a = tl.access.find((x) => x.no === Number(noRaw));
  if (!a?.lesson.homework) return send(b, c.failed);
  if (!tl.tariff.homework) return send(b, c.notInTariff);
  if (!a.open) return send(b, c.closed);
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_homework",
    hw_item: p.orderItemId,
    hw_lesson: a.lesson.id,
    hw_group: undefined,
  });
  await send(b, c.prompt(a.no, escapeHtml(a.lesson.title), escapeHtml(a.lesson.homework)));
}

/**
 * Это сообщение — ответ на задание? Да, если бот ждёт ответ, или это ещё
 * одна часть альбома, первая часть которого уже сдана.
 */
export function isHomeworkMessage(customer: Customer, msg: TelegramMessage): boolean {
  const s = customer.state;
  if (!s.hw_item || !s.hw_lesson) return false;
  if (s.mode === "awaiting_homework") return true;
  return Boolean(msg.media_group_id && s.hw_group === msg.media_group_id);
}

type Downloaded = { bytes: Uint8Array; name: string };
export type HomeworkDownloader = (fileId: string) => Promise<Uint8Array | null>;

/**
 * Файл из сообщения: голосовое, «кружок», видео или аудио (до 20 МБ —
 * предел скачивания Bot API), самое крупное фото или документ (до 3 МБ,
 * видео и аудио в документе — как медиа).
 */
export function pickFile(
  msg: TelegramMessage,
): { fileId: string; name: string } | "tooLarge" | null {
  const media =
    (msg.voice && { f: msg.voice, name: "voice.ogg" }) ||
    (msg.video_note && { f: msg.video_note, name: "video_note.mp4" }) ||
    (msg.video && { f: msg.video, name: msg.video.file_name ?? "video.mp4" }) ||
    (msg.audio && { f: msg.audio, name: msg.audio.file_name ?? "audio" });
  if (media) {
    if ((media.f.file_size ?? 0) > HW_MEDIA_MAX_BYTES) return "tooLarge";
    return { fileId: media.f.file_id, name: media.name };
  }
  if (msg.document) {
    const mt = msg.document.mime_type ?? "";
    const isMedia = mt.startsWith("video/") || mt.startsWith("audio/");
    if ((msg.document.file_size ?? 0) > (isMedia ? HW_MEDIA_MAX_BYTES : HW_FILE_MAX_BYTES))
      return "tooLarge";
    return { fileId: msg.document.file_id, name: msg.document.file_name ?? "file" };
  }
  if (msg.photo?.length) {
    const fit = msg.photo.filter((p) => (p.file_size ?? 0) <= HW_FILE_MAX_BYTES).at(-1);
    return fit ? { fileId: fit.file_id, name: "photo.jpg" } : "tooLarge";
  }
  return null;
}

export async function receiveHomework(
  b: CourseBot,
  msg: TelegramMessage,
  download: HomeworkDownloader,
  now = new Date(),
): Promise<void> {
  const c = COPY[b.locale];
  const s = b.customer.state;
  const p = await ownPurchase(b, String(s.hw_item));
  if (!p) {
    b.customer = await setState(b.ctx, b.customer, { ...s, mode: "idle", hw_group: undefined });
    return send(b, c.failed);
  }
  const text = (msg.text ?? msg.caption ?? "").trim();
  const files: HomeworkFile[] = [];
  const picked = pickFile(msg);
  if (picked === "tooLarge") return send(b, c.tooLarge);
  if (picked) {
    // Обрыв или тайм-аут скачивания — «не получилось», а не молчание бота.
    const got: Downloaded | null = await download(picked.fileId)
      .then((bytes) => (bytes ? { bytes, name: picked.name } : null))
      .catch(() => null);
    if (!got) return send(b, c.failed);
    const { uploadHomeworkFile } = await import("@/core/courses/homework.server");
    const up = await uploadHomeworkFile(
      b.ctx,
      p.orderItemId,
      got.bytes,
      got.name,
      HW_MEDIA_MAX_BYTES,
    );
    if (!up.ok)
      return send(
        b,
        up.reason === "badType" ? c.badFile : up.reason === "tooLarge" ? c.tooLarge : c.failed,
      );
    files.push(up.file);
  }
  if (!text && files.length === 0) return send(b, c.badFile);

  const { submitHomework } = await import("@/core/courses/homework.server");
  const r = await submitHomework(
    b.ctx,
    p,
    String(s.hw_lesson),
    { text, files, ...(msg.media_group_id ? { group: msg.media_group_id } : {}) },
    now,
  );
  if (!r.ok) {
    const reason = r.reason;
    return send(
      b,
      reason === "accepted"
        ? c.accepted
        : reason === "closed" || reason === "noHomework"
          ? c.closed
          : reason === "notInTariff"
            ? c.notInTariff
            : reason === "tooManyFiles"
              ? c.tooManyFiles
              : reason === "empty"
                ? c.badFile
                : c.failed,
    );
  }
  // Ответ принят: бот больше не ждёт; остальные части того же альбома
  // узнаются по hw_group и дописываются к этой сдаче.
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "idle",
    hw_group: msg.media_group_id,
  });
  if (r.merged) return;
  await send(b, c.sent);
  const { notifyHomework } = await import("./course-notify");
  await notifyHomework(b.ctx, r.homework).catch(() => 0);
}

// ── канал курса ──────────────────────────────────────────────────────

/** Приглашения в канал токеном бота магазина. */
export function telegramChannelInviter(api: TelegramApi): ChannelInviter {
  return {
    async createInvite(chatId, name, expireDate) {
      const r = await api.call<{ invite_link?: string }>("createChatInviteLink", {
        chat_id: chatId,
        name,
        expire_date: expireDate,
        member_limit: 1,
      });
      return r.ok && r.result?.invite_link ? r.result.invite_link : null;
    },
    async isMember(chatId, userId) {
      const r = await api.call<{ status?: string }>("getChatMember", {
        chat_id: chatId,
        user_id: userId,
      });
      if (!r.ok) return null;
      return ["member", "administrator", "creator", "restricted"].includes(r.result?.status ?? "");
    },
    async kick(chatId, userId) {
      // Исключение без запрета: бан и сразу разбан — вернуться можно по новой ссылке.
      const ban = await api.call("banChatMember", { chat_id: chatId, user_id: userId });
      if (!ban.ok) return false;
      await api.call("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
      return true;
    },
    async revokeInvite(chatId, link) {
      await api.call("revokeChatInviteLink", { chat_id: chatId, invite_link: link });
    },
  };
}

export async function sendChannelInvite(b: CourseBot, data: string): Promise<void> {
  const chat = data.startsWith("cchat:");
  const c = COPY[b.locale];
  const p = await ownPurchase(b, data.slice((chat ? "cchat:" : "cinv:").length));
  if (!p) return;
  const { courseChannelInvite, courseChatInvite } = await import("@/core/courses/channel.server");
  const access = telegramChannelInviter(b.api);
  const r = chat
    ? await courseChatInvite(b.ctx, p, access)
    : await courseChannelInvite(b.ctx, p, access);
  if (r.ok)
    return send(b, chat ? c.chatReady : c.inviteReady, {
      reply_markup: { inline_keyboard: [[{ text: c.inviteJoin, url: r.link }]] },
    });
  if (r.reason === "busy") return send(b, c.inviteBusy);
  if (r.reason === "alreadyMember") return send(b, chat ? c.chatAlready : c.inviteAlready);
  await send(b, chat ? c.chatFailed : c.inviteFailed);
  if (r.reason === "failed") {
    // Чаще всего бот не администратор канала — продавцу есть что исправить.
    const { notifyAdminsHtml } = await import("./notify");
    await notifyAdminsHtml(
      b.ctx,
      `⚠️ Ученик курса «${escapeHtml(p.name)}» не получил ссылку в ${chat ? "чат потока" : "канал курса"}. ` +
        "Проверьте, что бот магазина — администратор с правом приглашать участников.",
      { kind: "system" },
    ).catch(() => 0);
  }
}

/**
 * Событие chat_member в канале курса: вступил по личной ссылке — запомнить,
 * кто именно (core/courses/channel.server); любое вступление и выход —
 * на учёт сверки «в канале без доступа» (channel-seen.server).
 */
export async function handleCourseChannelMember(
  ctx: TenantContext,
  upd: {
    chat?: { id: number; username?: string };
    new_chat_member?: {
      status?: string;
      user?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
    };
    invite_link?: { invite_link?: string };
  },
): Promise<void> {
  if (!ctx.tenant.modules.courses) return;
  const link = upd.invite_link?.invite_link;
  const user = upd.new_chat_member?.user;
  const status = upd.new_chat_member?.status ?? "";
  if (!user?.id) return;
  if (link && ["member", "restricted"].includes(status)) {
    const { recordChannelJoin } = await import("@/core/courses/channel.server");
    await recordChannelJoin(ctx, link, user.id);
  }
  if (upd.chat) {
    const { recordChannelSighting } = await import("@/core/courses/channel-seen.server");
    await recordChannelSighting(ctx, upd.chat, user.id, status, {
      name: user.first_name ?? (user.username ? `@${user.username}` : ""),
      isBot: user.is_bot,
    });
  }
}

// ── урок в чате ──────────────────────────────────────────────────────

/** «Уроки в чате»: список открытых уроков кнопками. */
export async function showLessonList(b: CourseBot, data: string): Promise<void> {
  const c = COPY[b.locale];
  const p = await ownPurchase(b, data.slice("lsl:".length));
  if (!p) return;
  const { purchaseTimeline } = await import("@/core/courses/run.server");
  const open = purchaseTimeline(b.ctx, p).access.filter((a) => a.open);
  if (open.length === 0) return send(b, c.closed);
  await send(b, c.lessonsHeader, {
    reply_markup: {
      inline_keyboard: open.slice(-20).map((a) => [
        {
          text: `${a.no}. ${a.lesson.title}`.slice(0, 60),
          callback_data: `lsn:${p.orderItemId}:${a.no}`,
        },
      ]),
    },
  });
}

/**
 * Кнопка «Эфиры»: расписание потока. Ссылка на эфир — кнопкой и только у
 * начинающегося (за 15 минут) или идущего эфира; у остальных её нет в тексте.
 */
export async function showLives(b: CourseBot, data: string, now = new Date()): Promise<void> {
  const c = COPY[b.locale];
  const p = await ownPurchase(b, data.slice("lv:".length));
  if (!p) return;
  const { purchaseTimeline } = await import("@/core/courses/run.server");
  const { liveSchedule } = await import("@/core/courses/live-view");
  const lives = liveSchedule(purchaseTimeline(b.ctx, p, now), b.ctx.timezone, now);
  if (lives.length === 0) return send(b, c.livesEmpty);
  // Местное время эфира показываем как задано продавцом, без пересчёта.
  const fmt = new Intl.DateTimeFormat(b.locale, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const shown = lives.slice(-20);
  const rows: InlineButton[][] = [];
  for (const l of shown) {
    if (l.status === "open" && l.link)
      rows.push([{ text: `${c.liveJoin}: ${l.title}`.slice(0, 60), url: l.link }]);
    if (l.recording)
      rows.push([{ text: `${c.liveWatch}: ${l.title}`.slice(0, 60), url: l.recording }]);
  }
  const lines = shown.map((l) =>
    c.liveLine(fmt.format(new Date(`${l.at}:00Z`)), escapeHtml(l.title), l.status),
  );
  if (shown.some((l) => l.status === "open" && !l.link)) lines.push(c.liveNoLink);
  await send(
    b,
    `${c.livesHeader}\n\n${lines.join("\n")}`.slice(0, 4096),
    rows.length ? { reply_markup: { inline_keyboard: rows } } : {},
  );
}

/** Урок в чате: текст, ссылка на видео, материалы, задание со сдачей. */
export async function showLesson(b: CourseBot, data: string): Promise<void> {
  const c = COPY[b.locale];
  const [, itemId = "", noRaw = ""] = data.split(":");
  const p = await ownPurchase(b, itemId);
  if (!p) return;
  const { purchaseTimeline } = await import("@/core/courses/run.server");
  const tl = purchaseTimeline(b.ctx, p);
  const a = tl.access.find((x) => x.no === Number(noRaw));
  if (!a?.open) return send(b, c.closed);
  const l = a.lesson;
  const parts = [`📖 <b>${a.no}. ${escapeHtml(l.title)}</b>`];
  if (l.text) parts.push(escapeHtml(l.text));
  const { isTenantStorageKey } = await import("@/core/storage/keys");
  const { signedFileUrl } = await import("@/core/orders/orders");
  const files: string[] = [];
  for (const f of l.files) {
    if (!isTenantStorageKey(b.ctx.tenant.id, f.path)) continue;
    const url = await signedFileUrl(f.path, 24 * 3600, f.name ?? undefined).catch(() => null);
    if (url)
      files.push(
        `• <a href="${escapeHtml(url)}">${escapeHtml(f.name ?? f.path.split("/").pop() ?? "")}</a>`,
      );
  }
  if (files.length) parts.push(`${c.lessonFiles}\n${files.join("\n")}`);
  if (l.homework) parts.push(`📝 ${escapeHtml(l.homework)}`);
  const rows: InlineButton[][] = [];
  if (l.link) rows.push([{ text: "▶️ " + l.title.slice(0, 40), url: l.link }]);
  if (l.homework && tl.tariff.homework)
    rows.push([{ text: c.submitBtn(a.no), callback_data: `hw:${p.orderItemId}:${a.no}` }]);
  if (l.quiz) rows.push([quizButton(b, p.orderItemId, a.no)]);
  await send(
    b,
    parts.join("\n\n").slice(0, 4096),
    rows.length ? { reply_markup: { inline_keyboard: rows } } : {},
  );
}

/**
 * Открытый урок до покупки: кнопка под карточкой курса, `opl:<товар>:<номер>`.
 * Отдаём только урок с галочкой «Открытый урок» и без задания; номер чужого
 * или закрытого урока — то же сообщение «закрыто», без содержимого. Молчим
 * только на подделанный идентификатор товара.
 */
export async function showOpenLesson(b: CourseBot, data: string): Promise<void> {
  const c = COPY[b.locale];
  const [, productId = "", noRaw = ""] = data.split(":");
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return;
  const { previewLesson } = await import("@/core/courses/preview.server");
  const { signedFileUrl } = await import("@/core/orders/orders");
  const found = await previewLesson(b.ctx, productId, Number(noRaw), (path, name) =>
    signedFileUrl(path, 3600, name ?? undefined),
  );
  if (!found) return send(b, c.closed);
  const parts = [`🔓 <b>${noRaw}. ${escapeHtml(found.title)}</b>`];
  if (found.open.text) parts.push(escapeHtml(found.open.text));
  if (found.open.files.length)
    parts.push(
      `${c.lessonFiles}\n${found.open.files
        .map((f) => `• <a href="${escapeHtml(f.url)}">${escapeHtml(f.name)}</a>`)
        .join("\n")}`,
    );
  await send(
    b,
    parts.join("\n\n").slice(0, 4096),
    found.open.link
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: "▶️ " + found.title.slice(0, 40), url: found.open.link }]],
          },
        }
      : {},
  );
}
