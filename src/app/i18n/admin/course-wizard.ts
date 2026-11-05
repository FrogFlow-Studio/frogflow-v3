import type { SectionDict } from "../section";

/** Мастер «Новый курс»: название, цена и уроки на одном экране (ниша «Онлайн-школа»). */
export const ru = {
  "courseWizard.title": "Новый курс",
  "courseWizard.subtitle":
    "Название, цена и уроки — на одном экране. Текст уроков, файлы, задания и обложку можно добавить потом в карточке курса.",
  "courseWizard.name": "Название курса",
  "courseWizard.price": "Цена, {currency}",
  "courseWizard.description": "Коротко о курсе",
  "courseWizard.descriptionHint": "Необязательно. Покупатель увидит это на витрине и в боте.",
  "courseWizard.lessons": "Уроки",
  "courseWizard.lessonsHint":
    "По одному уроку в строке: «Название — ссылка на видео» (YouTube, Vimeo и другие, только https://). Ссылка нужна каждому уроку, ещё видео к уроку — отдельной строкой со ссылкой под ним; текст и файлы можно добавить потом в карточке курса. Чтобы разбить курс на модули, напишите строку с двоеточием на конце, например «Модуль 1. Основы:» — название модуля добавится к урокам под ней.",
  "courseWizard.lessonsPlaceholder":
    "Модуль 1. Основы:\nМатериалы и инструменты — https://youtu.be/...\nhttps://youtu.be/...\nРабочее место\n\nМодуль 2. Практика:\nКлассика 1:1 — https://youtu.be/...",
  "courseWizard.found": "Уроков: {n}. Модулей: {m}.",
  "courseWizard.preview": "Первый урок бесплатный — его можно посмотреть до оплаты",
  "courseWizard.submit": "Создать курс",
  "courseWizard.needLessons": "Добавьте хотя бы один урок.",
  "courseWizard.fixLines": "Исправьте эти строки — иначе они не попадут в курс.",
  "courseWizard.after": "После создания откроется карточка курса.",
  "courseWizard.full": "Открыть полную форму товара",
  "courseWizard.noLink": "Строка {line}: нет ссылки на видео — урок без неё не сохранится",
  "courseWizard.tooManyVideos": "Строка {line}: в уроке не больше {max} видео",
  "courseWizard.noModule": "Модуль «Курсы» не включён.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "courseWizard.title": "Жаңа курс",
  "courseWizard.subtitle":
    "Атауы, бағасы және сабақтары — бір экранда. Сабақ мәтінін, файлдарды, тапсырмаларды және мұқаба суретін кейін курс карточкасында қосуға болады.",
  "courseWizard.name": "Курс атауы",
  "courseWizard.price": "Бағасы, {currency}",
  "courseWizard.description": "Курс туралы қысқаша",
  "courseWizard.descriptionHint": "Міндетті емес. Сатып алушы мұны витринада және ботта көреді.",
  "courseWizard.lessons": "Сабақтар",
  "courseWizard.lessonsHint":
    "Әр жолда бір сабақ: «Атауы — бейне сілтемесі» (YouTube, Vimeo және басқалар, тек https://). Әр сабаққа сілтеме керек, сабаққа тағы бейне — астына жеке жолмен сілтеме; мәтін мен файлдарды кейін курс карточкасында қосуға болады. Курсты модульдерге бөлу үшін соңында қос нүктесі бар жол жазыңыз, мысалы «1-модуль. Негіздер:» — модуль атауы оның астындағы сабақтарға қосылады.",
  "courseWizard.lessonsPlaceholder":
    "1-модуль. Негіздер:\nМатериалдар мен құралдар — https://youtu.be/...\nЖұмыс орны\n\n2-модуль. Тәжірибе:\nКлассика 1:1 — https://youtu.be/...",
  "courseWizard.found": "Сабақ: {n}. Модуль: {m}.",
  "courseWizard.preview": "Бірінші сабақ тегін — оны төлемге дейін көруге болады",
  "courseWizard.submit": "Курс құру",
  "courseWizard.needLessons": "Кемінде бір сабақ қосыңыз.",
  "courseWizard.fixLines": "Мына жолдарды түзетіңіз — әйтпесе олар курсқа кірмейді.",
  "courseWizard.after": "Құрғаннан кейін курс карточкасы ашылады.",
  "courseWizard.full": "Тауардың толық формасын ашу",
  "courseWizard.noLink": "{line}-жол: бейне сілтемесі жоқ — онсыз сабақ сақталмайды",
  "courseWizard.tooManyVideos": "{line}-жол: сабақта {max} бейнеден артық болмайды",
  "courseWizard.noModule": "«Курстар» модулі қосылмаған.",
};

export const en: SectionDict<typeof ru> = {
  "courseWizard.title": "New course",
  "courseWizard.subtitle":
    "Name, price and lessons on one screen. Lesson text, files, homework and a cover can be added later in the course card.",
  "courseWizard.name": "Course name",
  "courseWizard.price": "Price, {currency}",
  "courseWizard.description": "About the course",
  "courseWizard.descriptionHint": "Optional. Buyers see it in the storefront and in the bot.",
  "courseWizard.lessons": "Lessons",
  "courseWizard.lessonsHint":
    "One lesson per line: “Title — video link” (YouTube, Vimeo and others, https:// only). Every lesson needs a link; add more videos to a lesson as separate link-only lines under it; text and files can be added later in the course card. To split the course into modules, write a line ending with a colon, e.g. “Module 1. Basics:” — the module name is added to the lessons below it.",
  "courseWizard.lessonsPlaceholder":
    "Module 1. Basics:\nMaterials and tools — https://youtu.be/...\nWorkplace\n\nModule 2. Practice:\nClassic 1:1 — https://youtu.be/...",
  "courseWizard.found": "Lessons: {n}. Modules: {m}.",
  "courseWizard.preview": "First lesson is free — it can be watched before paying",
  "courseWizard.submit": "Create course",
  "courseWizard.needLessons": "Add at least one lesson.",
  "courseWizard.fixLines": "Fix these lines, otherwise they won't get into the course.",
  "courseWizard.after": "The course card opens after creation.",
  "courseWizard.full": "Open the full product form",
  "courseWizard.noLink": "Line {line}: no video link — a lesson without it can’t be saved",
  "courseWizard.tooManyVideos": "Line {line}: a lesson has at most {max} videos",
  "courseWizard.noModule": "The “Courses” module is not enabled.",
};

export const uz: SectionDict<typeof ru> = {
  "courseWizard.title": "Yangi kurs",
  "courseWizard.subtitle":
    "Nomi, narxi va darslar — bitta ekranda. Dars matni, fayllar, vazifalar va muqovani keyinroq kurs kartochkasida qo‘shish mumkin.",
  "courseWizard.name": "Kurs nomi",
  "courseWizard.price": "Narxi, {currency}",
  "courseWizard.description": "Kurs haqida qisqacha",
  "courseWizard.descriptionHint": "Majburiy emas. Xaridor buni vitrinada va botda ko‘radi.",
  "courseWizard.lessons": "Darslar",
  "courseWizard.lessonsHint":
    "Har satrda bitta dars: «Nomi — video havolasi» (YouTube, Vimeo va boshqalar, faqat https://). Har bir darsga havola kerak, darsga yana video — ostiga alohida satrda havola; matn va fayllarni keyinroq kurs kartochkasida qo‘shish mumkin. Kursni modullarga bo‘lish uchun oxirida ikki nuqta bor satr yozing, masalan «1-modul. Asoslar:» — modul nomi uning ostidagi darslarga qo‘shiladi.",
  "courseWizard.lessonsPlaceholder":
    "1-modul. Asoslar:\nMateriallar va asboblar — https://youtu.be/...\nIsh joyi\n\n2-modul. Amaliyot:\nKlassika 1:1 — https://youtu.be/...",
  "courseWizard.found": "Darslar: {n}. Modullar: {m}.",
  "courseWizard.preview": "Birinchi dars bepul — uni to‘lovdan oldin ko‘rish mumkin",
  "courseWizard.submit": "Kurs yaratish",
  "courseWizard.needLessons": "Kamida bitta dars qo‘shing.",
  "courseWizard.fixLines": "Bu satrlarni tuzating — aks holda ular kursga kirmaydi.",
  "courseWizard.after": "Yaratilgandan keyin kurs kartochkasi ochiladi.",
  "courseWizard.full": "Mahsulotning to‘liq shaklini ochish",
  "courseWizard.noLink": "{line}-satr: video havolasi yo‘q — usiz dars saqlanmaydi",
  "courseWizard.tooManyVideos": "{line}-satr: darsda {max} tadan ortiq video bo‘lmaydi",
  "courseWizard.noModule": "«Kurslar» moduli yoqilmagan.",
};
