import type { SectionDict } from "../section";

/** Раздел «Тест к уроку» — редактор в карточке курса и сводка по ученику (ниша «Онлайн-школа»). */
export const ru = {
  "school.quizAdd": "+ Тест к уроку",
  "school.quizTitle": "Тест к уроку",
  "school.quizPass": "Проходной балл:",
  "school.quizRemove": "Убрать тест",
  "school.quizHint":
    "До 10 вопросов, в каждом 2–6 вариантов. Отметьте галочкой верные: один или несколько. Вопрос засчитывается, только если выбраны ровно верные варианты. Верные ответы ученик не видит; пройденный тест засчитывает урок как принятое задание (в режиме «по заданиям» откроет следующий урок).",
  "school.quizQuestion": "Текст вопроса",
  "school.quizOption": "Вариант {n}",
  "school.quizCorrect": "Верный вариант",
  "school.quizAddOption": "+ вариант",
  "school.quizAddQuestion": "+ вопрос",
  "school.quizRemoveQuestion": "Удалить вопрос",
  "school.quizRemoveOption": "Удалить вариант",
  "school.studentQuiz": "тесты {passed}/{lessons} · попыток {attempts}",
  "school.quizMaxAttempts": "Попыток (пусто — без лимита):",
  "school.quizPause": "Пауза между попытками, мин:",
  "school.quizResetAttempts": "Сбросить попытки теста",
  "school.quizResetDone": "Попытки сброшены: ученик может сдавать тест заново.",
  "school.quizResetFailed": "Попыток для сброса нет или сброс не удался — обновите страницу.",
  "err.course.badQuiz":
    "Тест в уроке {lesson}, вопрос {question}: нужен текст, 2–6 вариантов и хотя бы один верный; порог — 1–100 %.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "school.quizAdd": "+ Сабаққа тест",
  "school.quizTitle": "Сабаққа тест",
  "school.quizPass": "Өту балы:",
  "school.quizRemove": "Тестті алып тастау",
  "school.quizHint":
    "10 сұраққа дейін, әрқайсысында 2–6 нұсқа. Дұрыс нұсқаларды белгілеңіз: біреу немесе бірнеше. Сұрақ тек дәл дұрыс нұсқалар таңдалғанда есептеледі. Оқушы дұрыс жауаптарды көрмейді; өтілген тест сабақты қабылданған тапсырма ретінде есептейді («тапсырмалар бойынша» режимінде келесі сабақты ашады).",
  "school.quizQuestion": "Сұрақ мәтіні",
  "school.quizOption": "{n}-нұсқа",
  "school.quizCorrect": "Дұрыс нұсқа",
  "school.quizAddOption": "+ нұсқа",
  "school.quizAddQuestion": "+ сұрақ",
  "school.quizRemoveQuestion": "Сұрақты жою",
  "school.quizRemoveOption": "Нұсқаны жою",
  "school.studentQuiz": "тесттер {passed}/{lessons} · әрекет {attempts}",
  "school.quizMaxAttempts": "Әрекет (бос — шексіз):",
  "school.quizPause": "Әрекеттер арасындағы үзіліс, мин:",
  "school.quizResetAttempts": "Тест әрекеттерін қалпына келтіру",
  "school.quizResetDone": "Әрекеттер қалпына келтірілді: оқушы тестті қайта тапсыра алады.",
  "school.quizResetFailed":
    "Қалпына келтіретін әрекет жоқ немесе сәтсіз аяқталды — бетті жаңартыңыз.",
  "err.course.badQuiz":
    "{lesson}-сабақтағы тест, {question}-сұрақ: мәтін, 2–6 нұсқа және кемінде бір дұрыс жауап керек; шек — 1-ден 100 %-ға дейін.",
};

export const en: SectionDict<typeof ru> = {
  "school.quizAdd": "+ Lesson quiz",
  "school.quizTitle": "Lesson quiz",
  "school.quizPass": "Passing score:",
  "school.quizRemove": "Remove the quiz",
  "school.quizHint":
    "Up to 10 questions, 2–6 options each. Tick the correct ones: one or several. A question counts only when exactly the correct options are chosen. Students never see the correct answers; a passed quiz counts the lesson like an accepted homework (in the “by tasks” mode it opens the next lesson).",
  "school.quizQuestion": "Question text",
  "school.quizOption": "Option {n}",
  "school.quizCorrect": "Correct option",
  "school.quizAddOption": "+ option",
  "school.quizAddQuestion": "+ question",
  "school.quizRemoveQuestion": "Delete the question",
  "school.quizRemoveOption": "Delete the option",
  "school.studentQuiz": "quizzes {passed}/{lessons} · attempts {attempts}",
  "school.quizMaxAttempts": "Attempts (empty — no limit):",
  "school.quizPause": "Pause between attempts, min:",
  "school.quizResetAttempts": "Reset quiz attempts",
  "school.quizResetDone": "Attempts reset: the student can take the quiz again.",
  "school.quizResetFailed": "Nothing to reset or the reset failed — refresh the page.",
  "err.course.badQuiz":
    "Quiz in lesson {lesson}, question {question}: it needs text, 2–6 options and at least one correct; the pass mark is 1 to 100 %.",
};

export const uz: SectionDict<typeof ru> = {
  "school.quizAdd": "+ Dars testi",
  "school.quizTitle": "Dars testi",
  "school.quizPass": "O‘tish bali:",
  "school.quizRemove": "Testni olib tashlash",
  "school.quizHint":
    "10 tagacha savol, har birida 2–6 variant. To‘g‘rilarini belgilang: bitta yoki bir nechta. Savol faqat aynan to‘g‘ri variantlar tanlansa hisoblanadi. O‘quvchi to‘g‘ri javoblarni ko‘rmaydi; topshirilgan test darsni qabul qilingan vazifa kabi hisoblaydi («vazifalar bo‘yicha» rejimida keyingi darsni ochadi).",
  "school.quizQuestion": "Savol matni",
  "school.quizOption": "{n}-variant",
  "school.quizCorrect": "To‘g‘ri variant",
  "school.quizAddOption": "+ variant",
  "school.quizAddQuestion": "+ savol",
  "school.quizRemoveQuestion": "Savolni o‘chirish",
  "school.quizRemoveOption": "Variantni o‘chirish",
  "school.studentQuiz": "testlar {passed}/{lessons} · urinishlar {attempts}",
  "school.quizMaxAttempts": "Urinishlar (bo‘sh — cheklovsiz):",
  "school.quizPause": "Urinishlar orasidagi tanaffus, daqiqa:",
  "school.quizResetAttempts": "Test urinishlarini tiklash",
  "school.quizResetDone": "Urinishlar tiklandi: o‘quvchi testni qayta topshirishi mumkin.",
  "school.quizResetFailed": "Tiklash uchun urinish yo‘q yoki tiklab bo‘lmadi — sahifani yangilang.",
  "err.course.badQuiz":
    "{lesson}-darsdagi test, {question}-savol: matn, 2–6 variant va kamida bitta to‘g‘ri javob kerak; o‘tish bali — 1 dan 100 % gacha.",
};
