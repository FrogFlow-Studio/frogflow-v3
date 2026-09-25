import type { SectionDict } from "../section";

/** Раздел «chat» — ключи с префиксом `chat.`. */
export const ru = {
  "chat.title": "Чат с менеджером",
  "chat.subtitle":
    "Живые переписки бота с покупателями. Подключитесь к диалогу, чтобы отвечать самому — бот на это время замолчит для этого покупателя.",
  "chat.empty": "Диалогов пока нет: как только покупатель напишет боту, он появится здесь.",
  "chat.youInChat": "вы в чате",
  "chat.youPrefix": "Вы: ",
  "chat.noMessages": "Нет сообщений",
  "chat.pickDialog": "Выберите диалог слева.",
  "chat.returnToBot": "Вернуть боту",
  "chat.join": "Подключиться к диалогу",
  "chat.botAuto": "автоответ бота",
  "chat.placeholderActive": "Напишите покупателю…",
  "chat.placeholderInactive":
    "Ответ уйдёт покупателю; чтобы бот не отвечал вместо вас — подключитесь к диалогу",
  "chat.send": "Отправить",
} as const;

export const kk: SectionDict<typeof ru> = {
  "chat.title": "Менеджермен чат",
  "chat.subtitle":
    "Боттың сатып алушылармен тікелей хат алмасуы. Өзіңіз жауап беру үшін диалогқа қосылыңыз — бот осы уақытта бұл сатып алушыға үндемейді.",
  "chat.empty": "Диалогтар әзірге жоқ: сатып алушы ботқа жазған бойда ол осында пайда болады.",
  "chat.youInChat": "сіз чаттасыз",
  "chat.youPrefix": "Сіз: ",
  "chat.noMessages": "Хабарламалар жоқ",
  "chat.pickDialog": "Сол жақтан диалогты таңдаңыз.",
  "chat.returnToBot": "Ботқа қайтару",
  "chat.join": "Диалогқа қосылу",
  "chat.botAuto": "боттың автожауабы",
  "chat.placeholderActive": "Сатып алушыға жазыңыз…",
  "chat.placeholderInactive":
    "Жауап сатып алушыға кетеді; бот сіздің орныңызға жауап бермеуі үшін диалогқа қосылыңыз",
  "chat.send": "Жіберу",
};

export const en: SectionDict<typeof ru> = {
  "chat.title": "Manager chat",
  "chat.subtitle":
    "Live conversations between the bot and customers. Join a conversation to reply yourself — the bot goes quiet for that customer while you do.",
  "chat.empty":
    "No conversations yet: as soon as a customer messages the bot, it will show up here.",
  "chat.youInChat": "you're in the chat",
  "chat.youPrefix": "You: ",
  "chat.noMessages": "No messages",
  "chat.pickDialog": "Pick a conversation on the left.",
  "chat.returnToBot": "Hand back to the bot",
  "chat.join": "Join the conversation",
  "chat.botAuto": "bot auto-reply",
  "chat.placeholderActive": "Write to the customer…",
  "chat.placeholderInactive":
    "Your reply goes to the customer; join the conversation so the bot doesn't answer in your place",
  "chat.send": "Send",
};

export const uz: SectionDict<typeof ru> = {
  "chat.title": "Menejer bilan chat",
  "chat.subtitle":
    "Botning xaridorlar bilan jonli yozishmalari. O‘zingiz javob berish uchun suhbatga ulaning — bu vaqtda bot shu xaridorga javob bermaydi.",
  "chat.empty": "Suhbatlar hali yo‘q: xaridor botga yozishi bilan u shu yerda paydo bo‘ladi.",
  "chat.youInChat": "siz chatdasiz",
  "chat.youPrefix": "Siz: ",
  "chat.noMessages": "Xabarlar yo‘q",
  "chat.pickDialog": "Chap tomondan suhbatni tanlang.",
  "chat.returnToBot": "Botga qaytarish",
  "chat.join": "Suhbatga ulanish",
  "chat.botAuto": "botning avtojavobi",
  "chat.placeholderActive": "Xaridorga yozing…",
  "chat.placeholderInactive":
    "Javob xaridorga yuboriladi; bot sizning o‘rningizga javob bermasligi uchun suhbatga ulaning",
  "chat.send": "Yuborish",
};
