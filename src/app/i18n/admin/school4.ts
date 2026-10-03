import type { SectionDict } from "../section";

/** Раздел «Школа 4» — открытый урок, видео, тесты, воронка, потоки (ниша «Онлайн-школа»). */
export const ru = {
  "school.lessonPreview":
    "🔓 Открытый урок: его текст, ссылка и файлы видны всем до покупки — на витрине и в боте. Задание остаётся только ученикам.",
  "school.listAdd": "Добавить уроки списком",
  "school.listHint":
    "По одному уроку в строке: «Название — ссылка» (ссылка необязательна, только https). Уроки добавятся в конец курса, до {max} уроков.",
  "school.listSubmit": "Добавить в курс",
  "school.listCancel": "Отмена",
  "school.listAdded": "Добавлено уроков: {n}.",
  "school.listSkipped": "Не взято строк: {n} ({lines}).",
  "school.listOver": "Не поместилось в лимит {max} уроков: {n}.",
  "school.listNotHttps": "Строка {line}: ссылка должна начинаться с https://",
  "school.listNoTitle": "Строка {line}: у урока нет названия, только ссылка",
  "school.listTooLong": "Строка {line}: название длиннее {max} знаков",
  "school.listEmpty": "Нет ни одной строки с уроком.",
  "school.listSaveHint": "Не забудьте нажать «Сохранить» — уроки сохраняются вместе с курсом.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "school.lessonPreview":
    "🔓 Ашық сабақ: оның мәтіні, сілтемесі және файлдары сатып алғанға дейін барлығына көрінеді — витринада және ботта. Тапсырма тек оқушыларға қалады.",
  "school.listAdd": "Сабақтарды тізіммен қосу",
  "school.listHint":
    "Әр жолда бір сабақ: «Атауы — сілтеме» (сілтеме міндетті емес, тек https). Сабақтар курстың соңына қосылады, {max} сабаққа дейін.",
  "school.listSubmit": "Курсқа қосу",
  "school.listCancel": "Бас тарту",
  "school.listAdded": "Қосылған сабақ: {n}.",
  "school.listSkipped": "Алынбаған жол: {n} ({lines}).",
  "school.listOver": "{max} сабақ шегіне сыймады: {n}.",
  "school.listNotHttps": "{line}-жол: сілтеме https:// деп басталуы керек",
  "school.listNoTitle": "{line}-жол: сабақтың атауы жоқ, тек сілтеме",
  "school.listTooLong": "{line}-жол: атау {max} таңбадан ұзын",
  "school.listEmpty": "Сабағы бар бірде-бір жол жоқ.",
  "school.listSaveHint": "«Сақтау» түймесін басуды ұмытпаңыз — сабақтар курспен бірге сақталады.",
};

export const en: SectionDict<typeof ru> = {
  "school.lessonPreview":
    "🔓 Open lesson: its text, link and files are visible to everyone before purchase — in the storefront and in the bot. The homework stays for students only.",
  "school.listAdd": "Add lessons as a list",
  "school.listHint":
    "One lesson per line: “Title — link” (the link is optional, https only). Lessons are added at the end of the course, up to {max} lessons.",
  "school.listSubmit": "Add to the course",
  "school.listCancel": "Cancel",
  "school.listAdded": "Lessons added: {n}.",
  "school.listSkipped": "Lines skipped: {n} ({lines}).",
  "school.listOver": "Did not fit the limit of {max} lessons: {n}.",
  "school.listNotHttps": "Line {line}: the link must start with https://",
  "school.listNoTitle": "Line {line}: the lesson has no title, only a link",
  "school.listTooLong": "Line {line}: the title is longer than {max} characters",
  "school.listEmpty": "No lesson lines found.",
  "school.listSaveHint": "Remember to press “Save” — lessons are saved together with the course.",
};

export const uz: SectionDict<typeof ru> = {
  "school.lessonPreview":
    "🔓 Ochiq dars: uning matni, havolasi va fayllari xariddan oldin hammaga ko‘rinadi — vitrinada va botda. Vazifa faqat o‘quvchilar uchun qoladi.",
  "school.listAdd": "Darslarni ro‘yxat bilan qo‘shish",
  "school.listHint":
    "Har qatorda bitta dars: «Nomi — havola» (havola majburiy emas, faqat https). Darslar kursning oxiriga qo‘shiladi, {max} tagacha.",
  "school.listSubmit": "Kursga qo‘shish",
  "school.listCancel": "Bekor qilish",
  "school.listAdded": "Qo‘shilgan darslar: {n}.",
  "school.listSkipped": "Olinmagan qatorlar: {n} ({lines}).",
  "school.listOver": "{max} ta dars limitiga sig‘madi: {n}.",
  "school.listNotHttps": "{line}-qator: havola https:// bilan boshlanishi kerak",
  "school.listNoTitle": "{line}-qator: darsning nomi yo‘q, faqat havola",
  "school.listTooLong": "{line}-qator: nom {max} belgidan uzun",
  "school.listEmpty": "Darsli birorta qator topilmadi.",
  "school.listSaveHint":
    "«Saqlash» tugmasini bosishni unutmang — darslar kurs bilan birga saqlanadi.",
};
