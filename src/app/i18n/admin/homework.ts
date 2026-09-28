import type { SectionDict } from "../section";

/** Раздел «Домашние задания» — проверка работ учеников (ниша «Онлайн-школа»). */
export const ru = {
  "homework.nav": "Домашние задания",
  "homework.title": "Домашние задания",
  "homework.subtitle":
    "Работы учеников по урокам курсов. Примите или верните на доработку с комментарием — ученик получит ответ в своём канале, а на странице курса увидит отзыв.",
  "homework.tab.waiting": "На проверке",
  "homework.tab.all": "Все",
  "homework.empty": "Пока ни одной работы на проверке.",
  "homework.emptyAll":
    "Ученики ещё не сдавали домашние задания. Задание добавляется в уроке курса, в карточке товара.",
  "homework.lesson": "Урок {no} · {title}",
  "homework.attempt": "Сдано {date}",
  "homework.earlier": "Прежние версии: {count}",
  "homework.feedback": "Ваш отзыв",
  "homework.feedbackPlaceholder": "Что получилось, что исправить",
  "homework.accept": "✓ Принять",
  "homework.revise": "На доработку",
  "homework.status.submitted": "На проверке",
  "homework.status.accepted": "Принято",
  "homework.status.revise": "На доработке",
  "homework.notified": "Ученику отправлено сообщение.",
  "homework.notNotified": "Сообщение ученику не ушло — он увидит отзыв на странице курса.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "homework.nav": "Үй тапсырмалары",
  "homework.title": "Үй тапсырмалары",
  "homework.subtitle":
    "Оқушылардың курс сабақтары бойынша жұмыстары. Қабылдаңыз немесе түсініктемемен пысықтауға қайтарыңыз — оқушы жауапты өз арнасында алады, курс бетінде пікірді көреді.",
  "homework.tab.waiting": "Тексерілуде",
  "homework.tab.all": "Барлығы",
  "homework.empty": "Әзірге тексерілетін жұмыс жоқ.",
  "homework.emptyAll":
    "Оқушылар әлі үй тапсырмасын тапсырмаған. Тапсырма тауар карточкасындағы курс сабағына қосылады.",
  "homework.lesson": "{no}-сабақ · {title}",
  "homework.attempt": "Тапсырылды {date}",
  "homework.earlier": "Бұрынғы нұсқалар: {count}",
  "homework.feedback": "Сіздің пікіріңіз",
  "homework.feedbackPlaceholder": "Не шықты, нені түзету керек",
  "homework.accept": "✓ Қабылдау",
  "homework.revise": "Пысықтауға",
  "homework.status.submitted": "Тексерілуде",
  "homework.status.accepted": "Қабылданды",
  "homework.status.revise": "Пысықталуда",
  "homework.notified": "Оқушыға хабарлама жіберілді.",
  "homework.notNotified": "Оқушыға хабарлама кетпеді — ол пікірді курс бетінде көреді.",
};

export const en: SectionDict<typeof ru> = {
  "homework.nav": "Homework",
  "homework.title": "Homework",
  "homework.subtitle":
    "Students' work on course lessons. Accept it or return it for revision with a comment — the student gets the reply in their channel and sees your feedback on the course page.",
  "homework.tab.waiting": "To review",
  "homework.tab.all": "All",
  "homework.empty": "Nothing to review yet.",
  "homework.emptyAll":
    "Students haven't submitted any homework yet. Homework is added to a course lesson in the product card.",
  "homework.lesson": "Lesson {no} · {title}",
  "homework.attempt": "Submitted {date}",
  "homework.earlier": "Earlier versions: {count}",
  "homework.feedback": "Your feedback",
  "homework.feedbackPlaceholder": "What worked, what to fix",
  "homework.accept": "✓ Accept",
  "homework.revise": "Needs revision",
  "homework.status.submitted": "To review",
  "homework.status.accepted": "Accepted",
  "homework.status.revise": "In revision",
  "homework.notified": "The student has been notified.",
  "homework.notNotified":
    "The message to the student did not go through — they will see your feedback on the course page.",
};

export const uz: SectionDict<typeof ru> = {
  "homework.nav": "Uy vazifalari",
  "homework.title": "Uy vazifalari",
  "homework.subtitle":
    "O‘quvchilarning kurs darslari bo‘yicha ishlari. Qabul qiling yoki izoh bilan qayta ishlashga qaytaring — o‘quvchi javobni o‘z kanalida oladi va kurs sahifasida fikringizni ko‘radi.",
  "homework.tab.waiting": "Tekshiruvda",
  "homework.tab.all": "Hammasi",
  "homework.empty": "Hozircha tekshiriladigan ish yo‘q.",
  "homework.emptyAll":
    "O‘quvchilar hali uy vazifasini topshirmagan. Vazifa mahsulot kartochkasidagi kurs darsiga qo‘shiladi.",
  "homework.lesson": "{no}-dars · {title}",
  "homework.attempt": "Topshirildi {date}",
  "homework.earlier": "Avvalgi versiyalar: {count}",
  "homework.feedback": "Sizning fikringiz",
  "homework.feedbackPlaceholder": "Nima chiqdi, nimani tuzatish kerak",
  "homework.accept": "✓ Qabul qilish",
  "homework.revise": "Qayta ishlashga",
  "homework.status.submitted": "Tekshiruvda",
  "homework.status.accepted": "Qabul qilindi",
  "homework.status.revise": "Qayta ishlanmoqda",
  "homework.notified": "O‘quvchiga xabar yuborildi.",
  "homework.notNotified": "O‘quvchiga xabar yetmadi — u fikringizni kurs sahifasida ko‘radi.",
};
