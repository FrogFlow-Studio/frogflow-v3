import type { SectionDict } from "../section";

/** «Пригласить автора» в настройках: ссылка, условия и сводка (core/invites). */
export const ru = {
  "invite.title": "Пригласить автора",
  "invite.intro":
    "Дайте эту ссылку автору, которому подойдёт FrogFlow. Он получит скидку {percent} % на подключение в первом счёте. Вам за него — месяц подписки в зачёт, но только после того, как он реально оплатит тариф; зачёт выдаёт оператор платформы вручную.",
  "invite.copy": "Скопировать ссылку",
  "invite.copied": "Ссылка скопирована",
  "invite.registered": "Зарегистрировались по ссылке: {n}",
  "invite.paid": "Оплатили тариф: {n}",
  "invite.credited": "Месяц зачтён вам за: {n}",
  "invite.note":
    "Имена приглашённых не показываем. Оператор проверяет каждое приглашение: за регистрацию самого себя зачёт не выдаётся.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "invite.title": "Авторды шақыру",
  "invite.intro":
    "Бұл сілтемені FrogFlow сәйкес келетін авторға беріңіз. Ол бірінші шотта қосылуға {percent} % жеңілдік алады. Сізге ол үшін бір айлық жазылым есепке жазылады, бірақ ол тарифті шын төлегеннен кейін ғана; есепке жазуды платформа операторы қолмен жасайды.",
  "invite.copy": "Сілтемені көшіру",
  "invite.copied": "Сілтеме көшірілді",
  "invite.registered": "Сілтеме арқылы тіркелгендер: {n}",
  "invite.paid": "Тарифті төлегендер: {n}",
  "invite.credited": "Сізге ай есепке жазылғандар: {n}",
  "invite.note":
    "Шақырылғандардың аттарын көрсетпейміз. Оператор әр шақыруды тексереді: өзіңізді тіркегеніңіз үшін есепке жазу берілмейді.",
};

export const en: SectionDict<typeof ru> = {
  "invite.title": "Invite an author",
  "invite.intro":
    "Give this link to an author who would benefit from FrogFlow. They get {percent} % off the connection fee on the first invoice. You get a month of subscription credited, but only after they actually pay for a plan; the platform operator issues the credit by hand.",
  "invite.copy": "Copy link",
  "invite.copied": "Link copied",
  "invite.registered": "Signed up via your link: {n}",
  "invite.paid": "Paid for a plan: {n}",
  "invite.credited": "Month credited to you for: {n}",
  "invite.note":
    "We do not show who was invited. The operator checks every invitation: signing yourself up earns no credit.",
};

export const uz: SectionDict<typeof ru> = {
  "invite.title": "Muallifni taklif qilish",
  "invite.intro":
    "Bu havolani FrogFlow mos keladigan muallifga bering. U birinchi hisobda ulanish uchun {percent} % chegirma oladi. Siz uchun u tarifni haqiqatan toʻlagandan keyingina bir oylik obuna hisobga olinadi; hisobga olishni platforma operatori qoʻlda bajaradi.",
  "invite.copy": "Havolani nusxalash",
  "invite.copied": "Havola nusxalandi",
  "invite.registered": "Havola orqali roʻyxatdan oʻtganlar: {n}",
  "invite.paid": "Tarifni toʻlaganlar: {n}",
  "invite.credited": "Sizga bir oy hisobga olingan: {n}",
  "invite.note":
    "Taklif qilinganlarning nomini koʻrsatmaymiz. Operator har bir taklifni tekshiradi: oʻzingizni roʻyxatdan oʻtkazganingiz uchun hisobga olish berilmaydi.",
};
