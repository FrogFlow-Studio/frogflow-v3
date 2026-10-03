import type { Json } from "@/core/db-types";
import { setState } from "@/core/customers/customers";
import { answersFit, publicQuiz, type PublicQuiz } from "@/core/courses/lesson-quiz";
import type { Locale } from "@/core/i18n/locale";
import { escapeHtml } from "./copy";
import type { CourseBot } from "./courses";
import type { InlineButton } from "./types";

/**
 * Тест к уроку в боте (core/courses/lesson-quiz): вопросы по одному, варианты
 * кнопками. Верные ответы бот не знает — он собирает выбранное в состоянии
 * диалога (`state.qz`) и отдаёт ядру, которое оценивает и пишет попытку.
 * Кнопка несёт номер вопроса: нажатие на старый вопрос и двойной тап по
 * последнему ничего не меняют, а попытка пишется условно по счётчику.
 */
type Copy = {
  btn: string;
  ask: (n: number, total: number, text: string) => string;
  multi: string;
  done: string;
  passed: (score: number, total: number) => string;
  failed: (score: number, total: number, pass: number) => string;
  already: string;
  unavailable: string;
  cert: string;
};

const COPY: Record<Locale, Copy> = {
  ru: {
    btn: "🧪 Пройти тест",
    ask: (n, total, text) => `🧪 <b>Вопрос ${n} из ${total}</b>\n\n${text}`,
    multi: "Можно выбрать несколько ответов, затем нажмите «Готово».",
    done: "✅ Готово",
    passed: (s, t) => `🎉 Тест пройден: ${s} из ${t}. Урок засчитан.`,
    failed: (s, t, p) =>
      `Результат: ${s} из ${t}. Нужно верных ответов: ${p}%. Попробуйте ещё раз — кнопка «Пройти тест» в уроке.`,
    already: "Этот тест вы уже прошли.",
    unavailable: "Тест сейчас недоступен: урок закрыт или у него нет теста.",
    cert: "🎓 Курс пройден — сертификат ждёт вас на странице курса.",
  },
  kk: {
    btn: "🧪 Тестті тапсыру",
    ask: (n, total, text) => `🧪 <b>${total} сұрақтың ${n}-і</b>\n\n${text}`,
    multi: "Бірнеше жауап таңдауға болады, содан кейін «Дайын» түймесін басыңыз.",
    done: "✅ Дайын",
    passed: (s, t) => `🎉 Тест тапсырылды: ${t}-нің ${s}-і. Сабақ есептелді.`,
    failed: (s, t, p) =>
      `Нәтиже: ${t}-нің ${s}-і. Дұрыс жауап керек: ${p}%. Қайталап көріңіз — сабақтағы «Тестті тапсыру» түймесі.`,
    already: "Бұл тестті сіз тапсырып қойдыңыз.",
    unavailable: "Тест қазір қолжетімсіз: сабақ жабық немесе тесті жоқ.",
    cert: "🎓 Курс аяқталды — сертификат курс бетінде күтіп тұр.",
  },
  en: {
    btn: "🧪 Take the quiz",
    ask: (n, total, text) => `🧪 <b>Question ${n} of ${total}</b>\n\n${text}`,
    multi: "You can pick several answers, then tap “Done”.",
    done: "✅ Done",
    passed: (s, t) => `🎉 Quiz passed: ${s} of ${t}. The lesson is counted.`,
    failed: (s, t, p) =>
      `Result: ${s} of ${t}. Correct answers needed: ${p}%. Try again — the “Take the quiz” button in the lesson.`,
    already: "You have already passed this quiz.",
    unavailable: "The quiz is not available now: the lesson is closed or has no quiz.",
    cert: "🎓 Course completed — your certificate is waiting on the course page.",
  },
  uz: {
    btn: "🧪 Testni topshirish",
    ask: (n, total, text) => `🧪 <b>${total} ta savoldan ${n}-si</b>\n\n${text}`,
    multi: "Bir nechta javobni tanlash mumkin, so‘ng «Tayyor» tugmasini bosing.",
    done: "✅ Tayyor",
    passed: (s, t) => `🎉 Test topshirildi: ${t} tadan ${s} tasi. Dars hisoblandi.`,
    failed: (s, t, p) =>
      `Natija: ${t} tadan ${s} tasi. To‘g‘ri javoblar kerak: ${p}%. Qayta urinib ko‘ring — darsdagi «Testni topshirish» tugmasi.`,
    already: "Bu testni allaqachon topshirgansiz.",
    unavailable: "Test hozir mavjud emas: dars yopiq yoki testi yo‘q.",
    cert: "🎓 Kurs tugadi — sertifikat kurs sahifasida sizni kutmoqda.",
  },
};

type QuizState = {
  item: string;
  lesson: string;
  q: number;
  att: number;
  ans: number[][];
  sel: number[];
};

const nums = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];

function readState(b: CourseBot): QuizState | null {
  const s = b.customer.state.qz;
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const o = s as Record<string, unknown>;
  if (typeof o.item !== "string" || typeof o.lesson !== "string") return null;
  if (!Number.isInteger(o.q) || !Number.isInteger(o.att)) return null;
  return {
    item: o.item,
    lesson: o.lesson,
    q: o.q as number,
    att: o.att as number,
    ans: Array.isArray(o.ans) ? o.ans.map(nums) : [],
    sel: nums(o.sel),
  };
}

async function saveState(b: CourseBot, qz: QuizState | null) {
  const { qz: _old, ...rest } = b.customer.state;
  b.customer = await setState(
    b.ctx,
    b.customer,
    qz ? { ...rest, qz: qz as unknown as { [key: string]: Json | undefined } } : rest,
  );
}

async function say(b: CourseBot, text: string, extra: Record<string, unknown> = {}) {
  await b.api.call("sendMessage", {
    chat_id: b.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

function keyboard(c: Copy, quiz: PublicQuiz, q: number, sel: number[]): InlineButton[][] {
  const question = quiz.questions[q]!;
  const rows: InlineButton[][] = question.options.map((o, i) => [
    {
      text: `${question.multi && sel.includes(i) ? "☑️" : question.multi ? "⬜" : "▫️"} ${o}`.slice(
        0,
        60,
      ),
      callback_data: `qa:${q}:${i}`,
    },
  ]);
  if (question.multi) rows.push([{ text: c.done, callback_data: `qd:${q}` }]);
  return rows;
}

async function ask(b: CourseBot, quiz: PublicQuiz, q: number) {
  const c = COPY[b.locale];
  const question = quiz.questions[q]!;
  await say(
    b,
    c.ask(q + 1, quiz.questions.length, escapeHtml(question.text)) +
      (question.multi ? `\n\n<i>${c.multi}</i>` : ""),
    { reply_markup: { inline_keyboard: keyboard(c, quiz, q, []) } },
  );
}

/** Покупка этого покупателя и открытый урок с тестом; иначе null. */
async function quizLesson(b: CourseBot, itemId: string, lessonRef: { id?: string; no?: number }) {
  const { coursePurchase, purchaseTimeline } = await import("@/core/courses/run.server");
  const p = await coursePurchase(b.ctx, itemId);
  if (!p || p.telegramId !== b.customer.telegramId) return null;
  const a = purchaseTimeline(b.ctx, p).access.find((x) =>
    lessonRef.id ? x.lesson.id === lessonRef.id : x.no === lessonRef.no,
  );
  if (!a?.open || !a.lesson.quiz) return null;
  return { p, a, quiz: a.lesson.quiz };
}

/** Кнопка «Пройти тест» в уроке: `qz:<позиция>:<номер урока>`. */
export async function startQuiz(b: CourseBot, data: string): Promise<void> {
  const c = COPY[b.locale];
  const [, itemId = "", noRaw = ""] = data.split(":");
  const found = await quizLesson(b, itemId, { no: Number(noRaw) });
  if (!found) return say(b, c.unavailable);
  const { quizResult } = await import("@/core/courses/lesson-quiz.server");
  const result = await quizResult(b.ctx, itemId, found.a.lesson.id);
  if (result.passed) return say(b, c.already);
  await saveState(b, {
    item: itemId,
    lesson: found.a.lesson.id,
    q: 0,
    att: result.attempts,
    ans: [],
    sel: [],
  });
  await ask(b, publicQuiz(found.quiz), 0);
}

/**
 * Нажатие на вариант (`qa:<вопрос>:<вариант>`) или «Готово» (`qd:<вопрос>`).
 * Нажатие не на текущий вопрос игнорируется.
 */
export async function answerQuiz(b: CourseBot, data: string, messageId?: number): Promise<void> {
  const c = COPY[b.locale];
  const st = readState(b);
  const [kind, qRaw = "", oRaw = ""] = data.split(":");
  if (!st || Number(qRaw) !== st.q) return;
  const found = await quizLesson(b, st.item, { id: st.lesson });
  if (!found) {
    await saveState(b, null);
    return say(b, c.unavailable);
  }
  const quiz = publicQuiz(found.quiz);
  const question = quiz.questions[st.q];
  if (!question) return;
  let chosen: number[];
  if (kind === "qa") {
    const opt = Number(oRaw);
    if (!Number.isInteger(opt) || opt < 0 || opt >= question.options.length) return;
    if (question.multi) {
      const sel = st.sel.includes(opt) ? st.sel.filter((n) => n !== opt) : [...st.sel, opt];
      await saveState(b, { ...st, sel });
      if (messageId)
        await b.api.call("editMessageReplyMarkup", {
          chat_id: b.chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard(c, quiz, st.q, sel) },
        });
      return;
    }
    chosen = [opt];
  } else {
    if (!question.multi || st.sel.length === 0) return;
    chosen = st.sel;
  }
  const ans = [...st.ans.slice(0, st.q), chosen];
  if (st.q + 1 < quiz.questions.length) {
    await saveState(b, { ...st, q: st.q + 1, ans, sel: [] });
    return ask(b, quiz, st.q + 1);
  }
  // Последний ответ: состояние снимаем до отправки — повторное нажатие уйдёт в никуда.
  await saveState(b, null);
  if (!answersFit(found.quiz, ans)) return say(b, c.unavailable);
  const { submitQuiz } = await import("@/core/courses/lesson-quiz.server");
  const r = await submitQuiz(b.ctx, found.p, st.lesson, ans, st.att);
  // stale — этот же набор ответов уже принят параллельным нажатием: молчим.
  if (!r.ok) return r.reason === "stale" ? undefined : say(b, c.unavailable);
  await say(
    b,
    r.grade.passed
      ? c.passed(r.grade.score, r.grade.total)
      : c.failed(r.grade.score, r.grade.total, found.quiz.pass),
  );
  if (r.certificate) await say(b, c.cert);
  if (r.grade.passed) {
    const { announceLessonNow } = await import("./lesson-opened");
    await announceLessonNow(b.ctx, found.p.orderItemId);
  }
}

export const quizButton = (b: CourseBot, itemId: string, no: number): InlineButton => ({
  text: COPY[b.locale].btn,
  callback_data: `qz:${itemId}:${no}`,
});
