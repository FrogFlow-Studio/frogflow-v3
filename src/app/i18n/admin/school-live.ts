import type { SectionDict } from "../section";

/** Эфиры потока в карточке курса (ниша «Онлайн-школа», Ш1). */
export const ru = {
  "live.title": "Эфиры потока",
  "live.name": "Название эфира",
  "live.at": "Дата и время эфира",
  "live.link": "Ссылка на эфир",
  "live.add": "Добавить эфир",
  "live.save": "Сохранить эфир",
  "live.delete": "Удалить эфир",
  "live.deleteConfirm": "Удалить эфир «{title}»?",
  "live.full": "У потока уже {max} эфиров — больше добавить нельзя.",
  "live.hint":
    "Время — в поясе магазина. Ссылка — https (Zoom, Google Meet, Telegram); её можно добавить позже. Эфир записывается сразу своей кнопкой, кнопка «Сохранить» курса для него не нужна; у нового потока — после сохранения курса.",
  "err.live.noTitle": "Укажите название эфира (до {max} знаков).",
  "err.live.badTime": "Укажите дату и время эфира.",
  "err.live.badLink": "Ссылка на эфир должна начинаться с https://.",
  "err.live.tooMany": "У потока не больше {max} эфиров.",
  "err.live.noCohort": "Сначала сохраните курс с этим потоком, потом добавляйте эфиры.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "live.title": "Ағын эфирлері",
  "live.name": "Эфир атауы",
  "live.at": "Эфир күні мен уақыты",
  "live.link": "Эфирге сілтеме",
  "live.add": "Эфир қосу",
  "live.save": "Эфирді сақтау",
  "live.delete": "Эфирді жою",
  "live.deleteConfirm": "«{title}» эфирін жою керек пе?",
  "live.full": "Ағында {max} эфир бар — бұдан артық қосуға болмайды.",
  "live.hint":
    "Уақыт — дүкен белдеуінде. Сілтеме — https (Zoom, Google Meet, Telegram); оны кейін қосуға болады. Эфир өз батырмасымен бірден жазылады, ол үшін курстың «Сақтау» батырмасы керек емес; жаңа ағында — курсты сақтағаннан кейін.",
  "err.live.noTitle": "Эфир атауын көрсетіңіз ({max} таңбаға дейін).",
  "err.live.badTime": "Эфирдің күні мен уақытын көрсетіңіз.",
  "err.live.badLink": "Эфирге сілтеме https:// деп басталуы керек.",
  "err.live.tooMany": "Ағында {max} эфирден аспауы керек.",
  "err.live.noCohort": "Алдымен осы ағыны бар курсты сақтаңыз, содан кейін эфир қосыңыз.",
};

export const en: SectionDict<typeof ru> = {
  "live.title": "Cohort live sessions",
  "live.name": "Live session title",
  "live.at": "Live session date and time",
  "live.link": "Live session link",
  "live.add": "Add live session",
  "live.save": "Save live session",
  "live.delete": "Delete live session",
  "live.deleteConfirm": "Delete the live session “{title}”?",
  "live.full": "The cohort already has {max} live sessions — no more can be added.",
  "live.hint":
    "Time is in the shop's time zone. The link is https (Zoom, Google Meet, Telegram); it can be added later. A live session is saved at once with its own button, the course “Save” button is not needed; for a new cohort — after the course is saved.",
  "err.live.noTitle": "Enter the live session title (up to {max} characters).",
  "err.live.badTime": "Enter the live session date and time.",
  "err.live.badLink": "The live session link must start with https://.",
  "err.live.tooMany": "A cohort has at most {max} live sessions.",
  "err.live.noCohort": "First save the course with this cohort, then add live sessions.",
};

export const uz: SectionDict<typeof ru> = {
  "live.title": "Oqim efirlari",
  "live.name": "Efir nomi",
  "live.at": "Efir sanasi va vaqti",
  "live.link": "Efirga havola",
  "live.add": "Efir qo‘shish",
  "live.save": "Efirni saqlash",
  "live.delete": "Efirni o‘chirish",
  "live.deleteConfirm": "«{title}» efiri o‘chirilsinmi?",
  "live.full": "Oqimda allaqachon {max} ta efir bor — boshqa qo‘shib bo‘lmaydi.",
  "live.hint":
    "Vaqt — do‘kon mintaqasida. Havola — https (Zoom, Google Meet, Telegram); uni keyinroq qo‘shish mumkin. Efir o‘z tugmasi bilan darhol saqlanadi, kursning «Saqlash» tugmasi kerak emas; yangi oqimda — kurs saqlangandan keyin.",
  "err.live.noTitle": "Efir nomini kiriting ({max} belgigacha).",
  "err.live.badTime": "Efir sanasi va vaqtini kiriting.",
  "err.live.badLink": "Efirga havola https:// bilan boshlanishi kerak.",
  "err.live.tooMany": "Oqimda {max} tadan ortiq efir bo‘lmasligi kerak.",
  "err.live.noCohort": "Avval shu oqim bilan kursni saqlang, keyin efir qo‘shing.",
};
