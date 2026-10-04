import type { SectionDict } from "../section";

/** Сообщество авторов (С3): личные сообщения. */
export const ru = {
  "community.dm.tab": "Личные сообщения",
  "community.dm.notice":
    "Новое личное сообщение в сообществе от «{name}». Откройте «Сообщество → Личные сообщения».",
  "community.dm.empty": "Переписок пока нет.",
  "community.dm.authors": "Авторы сообщества",
  "community.dm.noAuthors": "Других авторов в сообществе пока нет.",
  "community.dm.write": "Написать",
  "community.dm.placeholder": "Сообщение",
  "community.dm.send": "Отправить",
  "community.dm.off": "Не принимать личные сообщения",
  "community.dm.offHint": "Авторы не смогут вам писать. Прежние переписки останутся.",
  "community.dm.block": "Запретить этому автору писать мне",
  "community.dm.unblock": "Снять запрет",
  "community.dm.blockedTitle": "Запретили писать вам",
  "community.dm.cantReply":
    "Ответить сейчас нельзя: автор выключил сообщество или личные сообщения.",
  "community.dm.fromYou": "Вы: ",
  "community.dm.soon": "Личные сообщения появятся, когда платформа их включит.",
  "err.community.dmOff": "Этот автор не принимает личные сообщения.",
  "err.community.dmUnavailable": "Этому автору сейчас нельзя написать.",
  "err.community.dmPair": "Этому автору вы уже написали несколько раз подряд. Подождите ответа.",
  "err.community.dmBlockedFull": "Список запретов заполнен.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "community.dm.tab": "Жеке хабарламалар",
  "community.dm.notice":
    "Қауымдастықта «{name}» авторынан жаңа жеке хабарлама. «Қауымдастық → Жеке хабарламалар» бөлімін ашыңыз.",
  "community.dm.empty": "Әзірге хат алмасу жоқ.",
  "community.dm.authors": "Қауымдастық авторлары",
  "community.dm.noAuthors": "Қауымдастықта басқа авторлар әзірге жоқ.",
  "community.dm.write": "Жазу",
  "community.dm.placeholder": "Хабарлама",
  "community.dm.send": "Жіберу",
  "community.dm.off": "Жеке хабарламаларды қабылдамау",
  "community.dm.offHint": "Авторлар сізге жаза алмайды. Бұрынғы хат алмасулар қалады.",
  "community.dm.block": "Бұл автордың маған жазуына тыйым салу",
  "community.dm.unblock": "Тыйымды алу",
  "community.dm.blockedTitle": "Сізге жазуға тыйым салынғандар",
  "community.dm.cantReply":
    "Қазір жауап беру мүмкін емес: автор қауымдастықты немесе жеке хабарламаларды өшірген.",
  "community.dm.fromYou": "Сіз: ",
  "community.dm.soon": "Жеке хабарламалар платформа қосқанда пайда болады.",
  "err.community.dmOff": "Бұл автор жеке хабарламаларды қабылдамайды.",
  "err.community.dmUnavailable": "Бұл авторға қазір жазу мүмкін емес.",
  "err.community.dmPair": "Бұл авторға қатарынан бірнеше рет жаздыңыз. Жауапты күтіңіз.",
  "err.community.dmBlockedFull": "Тыйымдар тізімі толған.",
};

export const en: SectionDict<typeof ru> = {
  "community.dm.tab": "Direct messages",
  "community.dm.notice":
    "New direct message in the community from “{name}”. Open “Community → Direct messages”.",
  "community.dm.empty": "No conversations yet.",
  "community.dm.authors": "Community authors",
  "community.dm.noAuthors": "No other authors in the community yet.",
  "community.dm.write": "Write",
  "community.dm.placeholder": "Message",
  "community.dm.send": "Send",
  "community.dm.off": "Do not accept direct messages",
  "community.dm.offHint": "Authors will not be able to write to you. Earlier conversations stay.",
  "community.dm.block": "Do not let this author write to me",
  "community.dm.unblock": "Remove the block",
  "community.dm.blockedTitle": "Not allowed to write to you",
  "community.dm.cantReply":
    "You cannot reply now: the author turned off the community or direct messages.",
  "community.dm.fromYou": "You: ",
  "community.dm.soon": "Direct messages will appear when the platform turns them on.",
  "err.community.dmOff": "This author does not accept direct messages.",
  "err.community.dmUnavailable": "You cannot write to this author right now.",
  "err.community.dmPair":
    "You have already written to this author several times in a row. Wait for a reply.",
  "err.community.dmBlockedFull": "The block list is full.",
};

export const uz: SectionDict<typeof ru> = {
  "community.dm.tab": "Shaxsiy xabarlar",
  "community.dm.notice":
    "Hamjamiyatda «{name}» muallifidan yangi shaxsiy xabar. «Hamjamiyat → Shaxsiy xabarlar»ni oching.",
  "community.dm.empty": "Hozircha yozishmalar yoʻq.",
  "community.dm.authors": "Hamjamiyat mualliflari",
  "community.dm.noAuthors": "Hamjamiyatda boshqa mualliflar hozircha yoʻq.",
  "community.dm.write": "Yozish",
  "community.dm.placeholder": "Xabar",
  "community.dm.send": "Yuborish",
  "community.dm.off": "Shaxsiy xabarlarni qabul qilmaslik",
  "community.dm.offHint": "Mualliflar sizga yoza olmaydi. Oldingi yozishmalar qoladi.",
  "community.dm.block": "Bu muallifga menga yozishni taqiqlash",
  "community.dm.unblock": "Taqiqni olib tashlash",
  "community.dm.blockedTitle": "Sizga yozish taqiqlanganlar",
  "community.dm.cantReply":
    "Hozir javob berib boʻlmaydi: muallif hamjamiyatni yoki shaxsiy xabarlarni oʻchirgan.",
  "community.dm.fromYou": "Siz: ",
  "community.dm.soon": "Shaxsiy xabarlar platforma yoqqanda paydo boʻladi.",
  "err.community.dmOff": "Bu muallif shaxsiy xabarlarni qabul qilmaydi.",
  "err.community.dmUnavailable": "Bu muallifga hozir yozib boʻlmaydi.",
  "err.community.dmPair": "Bu muallifga ketma-ket bir necha marta yozdingiz. Javobni kuting.",
  "err.community.dmBlockedFull": "Taqiqlar roʻyxati toʻla.",
};
