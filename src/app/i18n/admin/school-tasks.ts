import type { SectionDict } from "../section";

/** Раздел «Урок после ДЗ» — режим расписания «по заданиям» (ниша «Онлайн-школа»). */
export const ru = {
  "school.scheduleTasks": "По заданиям: следующий урок — после ДЗ предыдущего",
  "school.unlockAccepted": "когда преподаватель принял работу",
  "school.unlockSubmitted": "когда ученик сдал работу",
  "school.scheduleTasksHint":
    "Первый урок открывается со стартом (потока или покупки), каждый следующий — после домашнего задания предыдущего. Урок без задания следующий не задерживает. У тарифа без проверки ДЗ сдавать некому: следующий урок откроется, когда ученик отметит предыдущий пройденным.",
  "school.lessonOpensAfterTask": "Откроется после задания к уроку {n}",
} as const;

export const kk: SectionDict<typeof ru> = {
  "school.scheduleTasks": "Тапсырмалар бойынша: келесі сабақ — алдыңғысының ҮТ-нан кейін",
  "school.unlockAccepted": "оқытушы жұмысты қабылдағанда",
  "school.unlockSubmitted": "оқушы жұмысты тапсырғанда",
  "school.scheduleTasksHint":
    "Бірінші сабақ старттан (ағын немесе сатып алу) бірге ашылады, әрбір келесісі — алдыңғысының үй тапсырмасынан кейін. Тапсырмасыз сабақ келесісін кідіртпейді. ҮТ тексерілмейтін тарифте тапсыратын адам жоқ: келесі сабақ оқушы алдыңғысын өтті деп белгілегенде ашылады.",
  "school.lessonOpensAfterTask": "{n}-сабақтың тапсырмасынан кейін ашылады",
};

export const en: SectionDict<typeof ru> = {
  "school.scheduleTasks": "By tasks: the next lesson opens after the previous homework",
  "school.unlockAccepted": "when the teacher accepts the work",
  "school.unlockSubmitted": "when the student submits the work",
  "school.scheduleTasksHint":
    "The first lesson opens at the start (cohort or purchase), each next one after the homework of the previous. A lesson without homework does not hold the next one. On a tier without homework review there is nobody to submit to: the next lesson opens once the student marks the previous one as done.",
  "school.lessonOpensAfterTask": "Opens after the homework of lesson {n}",
};

export const uz: SectionDict<typeof ru> = {
  "school.scheduleTasks": "Vazifalar bo‘yicha: keyingi dars — oldingisining vazifasidan keyin",
  "school.unlockAccepted": "o‘qituvchi ishni qabul qilganda",
  "school.unlockSubmitted": "o‘quvchi ishni topshirganda",
  "school.scheduleTasksHint":
    "Birinchi dars start bilan (oqim yoki xarid) ochiladi, har bir keyingisi — oldingisining uy vazifasidan keyin. Vazifasiz dars keyingisini ushlab turmaydi. Vazifa tekshirilmaydigan tarifda topshiradigan kishi yo‘q: keyingi dars o‘quvchi oldingisini o‘tilgan deb belgilaganda ochiladi.",
  "school.lessonOpensAfterTask": "{n}-dars vazifasidan keyin ochiladi",
};
