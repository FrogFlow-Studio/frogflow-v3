import type { SectionDict } from "../section";

/** Раздел «Где отваливаются» — воронка курса на странице «Ученики» (ниша «Онлайн-школа»). */
export const ru = {
  "school.funnelTitle": "Где отваливаются",
  "school.funnelHint":
    "По урокам: сколько учеников открыли урок, сдали задание и прошли его. Нажмите на цифру, чтобы увидеть, кто это. Прошли курс — открыты все уроки и приняты задания (на тарифе без проверки — отмечены все уроки).",
  "school.funnelCohort": "Поток:",
  "school.funnelAllCohorts": "Все потоки",
  "school.funnelEmpty": "Пока нет учеников.",
  "school.funnelLesson": "Урок",
  "school.funnelOpened": "Открыли",
  "school.funnelHomework": "Сдали ДЗ",
  "school.funnelDone": "Прошли",
  "school.funnelFinished": "Прошли курс",
  "school.funnelOf": "Учеников в выборке: {n}",
  "school.funnelOpenedOf": "Открыли урок {no}",
  "school.funnelHomeworkOf": "Сдали ДЗ к уроку {no}",
  "school.funnelDoneOf": "Прошли урок {no}",
} as const;

export const kk: SectionDict<typeof ru> = {
  "school.funnelTitle": "Қайда түсіп қалады",
  "school.funnelHint":
    "Сабақтар бойынша: қанша оқушы сабақты ашты, тапсырма тапсырды және өтті. Кім екенін көру үшін санды басыңыз. Курсты өтті — барлық сабақ ашық және тапсырмалар қабылданған (тексерусіз тарифте — барлық сабақ өтілген деп белгіленген).",
  "school.funnelCohort": "Ағын:",
  "school.funnelAllCohorts": "Барлық ағындар",
  "school.funnelEmpty": "Әзірге оқушы жоқ.",
  "school.funnelLesson": "Сабақ",
  "school.funnelOpened": "Ашты",
  "school.funnelHomework": "ҮТ тапсырды",
  "school.funnelDone": "Өтті",
  "school.funnelFinished": "Курсты өтті",
  "school.funnelOf": "Таңдамадағы оқушылар: {n}",
  "school.funnelOpenedOf": "{no}-сабақты ашты",
  "school.funnelHomeworkOf": "{no}-сабақтың ҮТ-н тапсырды",
  "school.funnelDoneOf": "{no}-сабақты өтті",
};

export const en: SectionDict<typeof ru> = {
  "school.funnelTitle": "Where students drop off",
  "school.funnelHint":
    "By lesson: how many students opened the lesson, submitted the homework and passed it. Click a number to see who they are. Finished the course — all lessons are open and the homework is accepted (on a tier without review — all lessons are marked as done).",
  "school.funnelCohort": "Cohort:",
  "school.funnelAllCohorts": "All cohorts",
  "school.funnelEmpty": "No students yet.",
  "school.funnelLesson": "Lesson",
  "school.funnelOpened": "Opened",
  "school.funnelHomework": "Submitted HW",
  "school.funnelDone": "Passed",
  "school.funnelFinished": "Finished the course",
  "school.funnelOf": "Students in the selection: {n}",
  "school.funnelOpenedOf": "Opened lesson {no}",
  "school.funnelHomeworkOf": "Submitted homework for lesson {no}",
  "school.funnelDoneOf": "Passed lesson {no}",
};

export const uz: SectionDict<typeof ru> = {
  "school.funnelTitle": "Qayerda tushib qolishadi",
  "school.funnelHint":
    "Darslar bo‘yicha: nechta o‘quvchi darsni ochdi, vazifani topshirdi va o‘tdi. Kimligini ko‘rish uchun raqamni bosing. Kursni tugatdi — barcha darslar ochiq va vazifalar qabul qilingan (tekshiruvsiz tarifda — barcha darslar o‘tilgan deb belgilangan).",
  "school.funnelCohort": "Oqim:",
  "school.funnelAllCohorts": "Barcha oqimlar",
  "school.funnelEmpty": "Hozircha o‘quvchilar yo‘q.",
  "school.funnelLesson": "Dars",
  "school.funnelOpened": "Ochdi",
  "school.funnelHomework": "Vazifa topshirdi",
  "school.funnelDone": "O‘tdi",
  "school.funnelFinished": "Kursni tugatdi",
  "school.funnelOf": "Tanlovdagi o‘quvchilar: {n}",
  "school.funnelOpenedOf": "{no}-darsni ochdi",
  "school.funnelHomeworkOf": "{no}-dars vazifasini topshirdi",
  "school.funnelDoneOf": "{no}-darsdan o‘tdi",
};
