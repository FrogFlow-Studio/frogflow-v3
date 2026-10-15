import type { SectionDict } from "../section";

/** ИИ-наставник урока: переключатель в карточке курса и журнал вопросов в «Домашних заданиях». */
export const ru = {
  "tutor.toggle": "ИИ-наставник на странице курса",
  "tutor.toggleHint":
    "Под каждым открытым уроком ученик может задать вопрос. Наставник видит текст урока, задание, последнюю сдачу ученика и ваш отзыв, объясняет ошибку и подсказывает следующий шаг, но готовый ответ не даёт. Ответы теста ему не передаются. До 15 вопросов в день на урок; расход — с ИИ-баланса. Если ИИ недоступен, ученику предлагается спросить куратора. Вопросы и ответы видны в «Домашних заданиях».",
  "tutor.log.title": "Вопросы ИИ-наставнику",
  "tutor.log.hint":
    "Что ученики спрашивали у наставника по урокам и что он ответил. Здесь видно, где ученики застревают.",
  "tutor.log.count": "вопросов: {n}",
  "tutor.log.unavailable": "ИИ был недоступен — ученику предложено спросить куратора.",
};

export const kk: SectionDict<typeof ru> = {
  "tutor.toggle": "Курс бетіндегі ЖИ-тәлімгер",
  "tutor.toggleHint":
    "Әр ашық сабақтың астында оқушы сұрақ қоя алады. Тәлімгер сабақ мәтінін, тапсырманы, оқушының соңғы жұмысын және сіздің пікіріңізді көреді, қатені түсіндіріп, келесі қадамды айтады, бірақ дайын жауап бермейді. Тест жауаптары оған берілмейді. Бір сабаққа күніне 15 сұраққа дейін; шығын — ЖИ-баланстан. ЖИ қолжетімсіз болса, оқушыға кураторға жазу ұсынылады. Сұрақтар мен жауаптар «Үй тапсырмаларында» көрінеді.",
  "tutor.log.title": "ЖИ-тәлімгерге сұрақтар",
  "tutor.log.hint":
    "Оқушылар сабақтар бойынша тәлімгерден не сұрады және ол не жауап берді. Оқушылар қай жерде қиналатыны көрінеді.",
  "tutor.log.count": "сұрақ: {n}",
  "tutor.log.unavailable": "ЖИ қолжетімсіз болды — оқушыға кураторға жазу ұсынылды.",
};

export const en: SectionDict<typeof ru> = {
  "tutor.toggle": "AI tutor on the course page",
  "tutor.toggleHint":
    "Under every open lesson the student can ask a question. The tutor sees the lesson text, the task, the student's latest submission and your feedback, explains the mistake and suggests the next step, but never gives the ready answer. Quiz answers are never passed to it. Up to 15 questions a day per lesson; costs come from the AI balance. If AI is unavailable, the student is told to ask the curator. Questions and answers are shown in Homework.",
  "tutor.log.title": "Questions to the AI tutor",
  "tutor.log.hint":
    "What students asked the tutor about lessons and what it answered. Shows where students get stuck.",
  "tutor.log.count": "questions: {n}",
  "tutor.log.unavailable": "AI was unavailable; the student was told to ask the curator.",
};

export const uz: SectionDict<typeof ru> = {
  "tutor.toggle": "Kurs sahifasida SI-ustoz",
  "tutor.toggleHint":
    "Har bir ochiq dars ostida o‘quvchi savol berishi mumkin. Ustoz dars matnini, topshiriqni, o‘quvchining oxirgi ishini va sizning fikringizni ko‘radi, xatoni tushuntiradi va keyingi qadamni aytadi, lekin tayyor javob bermaydi. Test javoblari unga berilmaydi. Bir darsga kuniga 15 tagacha savol; xarajat — SI-balansdan. SI mavjud bo‘lmasa, o‘quvchiga kuratordan so‘rash taklif qilinadi. Savollar va javoblar «Uy vazifalari»da ko‘rinadi.",
  "tutor.log.title": "SI-ustozga savollar",
  "tutor.log.hint":
    "O‘quvchilar darslar bo‘yicha ustozdan nima so‘radi va u nima javob berdi. O‘quvchilar qayerda qiynalayotgani ko‘rinadi.",
  "tutor.log.count": "savollar: {n}",
  "tutor.log.unavailable": "SI mavjud emas edi — o‘quvchiga kuratordan so‘rash taklif qilindi.",
};
