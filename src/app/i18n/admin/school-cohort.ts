import type { SectionDict } from "../section";

/** Раздел «Следующий поток» — копия последнего потока курса (ниша «Онлайн-школа»). */
export const ru = {
  "school.nextCohortStart": "Старт следующего потока",
  "school.nextCohortCreate": "Создать следующий поток",
  "school.nextCohortHint":
    "Копия последнего потока: время старта то же, начало и конец набора сдвигаются на выбранную дату, к названию добавляется номер. Групповой чат не копируется. Ученики и их прохождения не меняются. Поток создаётся и записывается сразу.",
  "err.course.nextNoCohorts":
    "Сначала создайте и сохраните хотя бы один поток: следующий — его копия.",
  "err.course.nextBadDay": "Выберите дату старта следующего потока.",
  "err.course.nextNotLater": "Старт следующего потока должен быть позже старта последнего.",
  "err.course.nextTooMany": "В курсе не больше {max} потоков.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "school.nextCohortStart": "Келесі ағынның басталуы",
  "school.nextCohortCreate": "Келесі ағынды құру",
  "school.nextCohortHint":
    "Соңғы ағынның көшірмесі: басталу уақыты сол, қабылдаудың басы мен соңы таңдалған күнге жылжиды, атауына нөмір қосылады. Топтық чат көшірілмейді. Оқушылар мен олардың өтуі өзгермейді. Ағын бірден құрылып, жазылады.",
  "err.course.nextNoCohorts":
    "Алдымен кемінде бір ағынды құрып, сақтаңыз: келесісі — оның көшірмесі.",
  "err.course.nextBadDay": "Келесі ағынның басталу күнін таңдаңыз.",
  "err.course.nextNotLater": "Келесі ағын соңғысынан кейін басталуы керек.",
  "err.course.nextTooMany": "Курста {max} ағыннан аспауы керек.",
};

export const en: SectionDict<typeof ru> = {
  "school.nextCohortStart": "Next cohort start",
  "school.nextCohortCreate": "Create the next cohort",
  "school.nextCohortHint":
    "A copy of the last cohort: the same start time, the enrolment start and end move by the chosen date, a number is added to the title. The group chat is not copied. Students and their progress do not change. The cohort is created and saved at once.",
  "err.course.nextNoCohorts":
    "First create and save at least one cohort: the next one is its copy.",
  "err.course.nextBadDay": "Choose the start date of the next cohort.",
  "err.course.nextNotLater": "The next cohort must start later than the last one.",
  "err.course.nextTooMany": "A course has at most {max} cohorts.",
};

export const uz: SectionDict<typeof ru> = {
  "school.nextCohortStart": "Keyingi oqim boshlanishi",
  "school.nextCohortCreate": "Keyingi oqimni yaratish",
  "school.nextCohortHint":
    "Oxirgi oqimning nusxasi: boshlanish vaqti o‘sha, qabulning boshi va oxiri tanlangan sanaga suriladi, nomiga raqam qo‘shiladi. Guruh chati nusxalanmaydi. O‘quvchilar va ularning o‘tishi o‘zgarmaydi. Oqim darhol yaratiladi va saqlanadi.",
  "err.course.nextNoCohorts":
    "Avval kamida bitta oqim yarating va saqlang: keyingisi — uning nusxasi.",
  "err.course.nextBadDay": "Keyingi oqimning boshlanish sanasini tanlang.",
  "err.course.nextNotLater": "Keyingi oqim oxirgisidan keyin boshlanishi kerak.",
  "err.course.nextTooMany": "Kursda {max} tadan ortiq oqim bo‘lmasligi kerak.",
};
