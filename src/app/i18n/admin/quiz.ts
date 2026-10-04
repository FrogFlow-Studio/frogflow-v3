import type { SectionDict } from "../section";

/** Раздел «Квиз-подбор». */
export const ru = {
  "quiz.title": "Квиз-подбор",
  "quiz.subtitle":
    "Кнопка «🧩 Подобрать товар» в меню бота: несколько вопросов — и бот показывает до трёх подходящих товаров.",
  "quiz.intro": "Приветствие перед вопросами",
  "quiz.question": "Вопрос {n}",
  "quiz.optionLabel": "Вариант",
  "quiz.optionTags": "Теги через запятую",
  "quiz.tagsHint":
    "Тег — начало слова в названии, ключевых словах или описании товара: «пропис» найдёт «прописи», «кот» найдёт «кота» и «котёнок», но не «скотч». Чем больше тегов совпало, тем выше товар в подборе.",
  "quiz.addOption": "+ вариант",
  "quiz.addQuestion": "+ Вопрос",
  "quiz.removeQuestion": "Удалить вопрос",
  "quiz.preview": "Проверить подбор",
  "quiz.previewHint": "Выберите по варианту в каждом вопросе — увидите, что предложит бот.",
  "quiz.previewEmpty": "Ничего не подобралось — добавьте теги или ключевые слова товарам.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "quiz.title": "Квиз-таңдау",
  "quiz.subtitle":
    "Бот мәзіріндегі «🧩 Тауар таңдау» түймесі: бірнеше сұрақ — және бот үш сәйкес тауарға дейін көрсетеді.",
  "quiz.intro": "Сұрақтар алдындағы сәлемдесу",
  "quiz.question": "{n}-сұрақ",
  "quiz.optionLabel": "Нұсқа",
  "quiz.optionTags": "Тегтер үтір арқылы",
  "quiz.tagsHint":
    "Тег — тауардың атауындағы, кілт сөздеріндегі немесе сипаттамасындағы сөздің басы: «пропис» «прописи» деп, «кот» «кота» мен «котёнок» деп табады, бірақ «скотч» деп таппайды. Көп тег сәйкес келсе, тауар жоғарырақ болады.",
  "quiz.addOption": "+ нұсқа",
  "quiz.addQuestion": "+ Сұрақ",
  "quiz.removeQuestion": "Сұрақты жою",
  "quiz.preview": "Таңдауды тексеру",
  "quiz.previewHint": "Әр сұрақта бір нұсқаны таңдаңыз — бот не ұсынатынын көресіз.",
  "quiz.previewEmpty": "Ештеңе табылмады — тауарларға тег немесе кілт сөз қосыңыз.",
};

export const en: SectionDict<typeof ru> = {
  "quiz.title": "Product quiz",
  "quiz.subtitle":
    "A “🧩 Find a product” button in the bot menu: a few questions, then the bot shows up to three matching products.",
  "quiz.intro": "Greeting before the questions",
  "quiz.question": "Question {n}",
  "quiz.optionLabel": "Option",
  "quiz.optionTags": "Tags, comma-separated",
  "quiz.tagsHint":
    "A tag matches the beginning of a word in the product name, keywords or description: “пропис” finds “прописи”, “кот” finds “кота” and “котёнок” but not “скотч”. The more tags match, the higher the product ranks.",
  "quiz.addOption": "+ option",
  "quiz.addQuestion": "+ Question",
  "quiz.removeQuestion": "Remove question",
  "quiz.preview": "Test the picker",
  "quiz.previewHint": "Pick one option per question to see what the bot will suggest.",
  "quiz.previewEmpty": "Nothing matched — add tags or keywords to your products.",
};

export const uz: SectionDict<typeof ru> = {
  "quiz.title": "Kviz-tanlash",
  "quiz.subtitle":
    "Bot menyusidagi «🧩 Mahsulot tanlash» tugmasi: bir nechta savol — va bot uchtagacha mos mahsulot ko‘rsatadi.",
  "quiz.intro": "Savollardan oldingi salomlashish",
  "quiz.question": "{n}-savol",
  "quiz.optionLabel": "Variant",
  "quiz.optionTags": "Teglar vergul orqali",
  "quiz.tagsHint":
    "Teg mahsulot nomi, kalit so‘zlari yoki tavsifidagi so‘zning boshi bilan mos keladi: «пропис» «прописи»ni, «кот» «кота» va «котёнок»ni topadi, lekin «скотч»ni topmaydi. Ko‘proq teg mos kelsa, mahsulot yuqoriroq bo‘ladi.",
  "quiz.addOption": "+ variant",
  "quiz.addQuestion": "+ Savol",
  "quiz.removeQuestion": "Savolni o‘chirish",
  "quiz.preview": "Tanlashni tekshirish",
  "quiz.previewHint":
    "Har bir savolda bitta variantni tanlang — bot nima taklif qilishini ko‘rasiz.",
  "quiz.previewEmpty": "Hech narsa topilmadi — mahsulotlarga teg yoki kalit so‘z qo‘shing.",
};
