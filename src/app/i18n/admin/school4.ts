import type { SectionDict } from "../section";

/** Раздел «Школа 4» — открытый урок, видео, тесты, воронка, потоки (ниша «Онлайн-школа»). */
export const ru = {
  "school.lessonPreview":
    "🔓 Открытый урок: его текст, ссылка и файлы видны всем до покупки — на витрине и в боте. Задание остаётся только ученикам.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "school.lessonPreview":
    "🔓 Ашық сабақ: оның мәтіні, сілтемесі және файлдары сатып алғанға дейін барлығына көрінеді — витринада және ботта. Тапсырма тек оқушыларға қалады.",
};

export const en: SectionDict<typeof ru> = {
  "school.lessonPreview":
    "🔓 Open lesson: its text, link and files are visible to everyone before purchase — in the storefront and in the bot. The homework stays for students only.",
};

export const uz: SectionDict<typeof ru> = {
  "school.lessonPreview":
    "🔓 Ochiq dars: uning matni, havolasi va fayllari xariddan oldin hammaga ko‘rinadi — vitrinada va botda. Vazifa faqat o‘quvchilar uchun qoladi.",
};
