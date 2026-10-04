import type { SectionDict } from "../section";

/** Сообщество авторов (С1): профиль и согласие в «Настройки → Сообщество». */
export const ru = {
  "settings.community.title": "Сообщество авторов",
  "settings.community.intro":
    "Сообщество — место, где авторы платформы обмениваются опытом. Сейчас вы можете заполнить профиль и дать согласие. Пока выключено, вас не видно другим авторам, и вы ничего не читаете и не пишете. Данные магазина (заказы, суммы, покупатели) в сообщество не попадают никогда.",
  "settings.community.on": "Показывать меня в сообществе",
  "settings.community.name": "Название",
  "settings.community.niche": "Ниша",
  "settings.community.city": "Город",
  "settings.community.about": "Чем занимаюсь",
  "settings.community.links": "Ссылки (по одной в строке, начинаются с https://)",
  "settings.community.state.off": "Выключено: вас не видно другим авторам.",
  "settings.community.state.visible": "Включено: другие авторы видят этот профиль.",
  "settings.community.state.hidden":
    "Оператор платформы скрыл вас из списка авторов. Остальное работает.",
  "settings.community.state.blocked":
    "Оператор платформы закрыл вам доступ к сообществу. Если это ошибка, напишите в поддержку.",
  "settings.community.reason": "Причина: {reason}",
  "settings.community.ownerOnly": "Профиль меняет владелец магазина.",
  "err.community.noName": "Чтобы показываться в сообществе, укажите название.",
  "err.community.oldPlatform": "Сообщество доступно магазинам на новой платформе.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.community.title": "Авторлар қауымдастығы",
  "settings.community.intro":
    "Қауымдастық — платформа авторлары тәжірибе алмасатын орын. Қазір профильді толтырып, келісім бере аласыз. Өшірулі болса, сізді басқа авторлар көрмейді, сіз де ештеңе оқымайсыз және жазбайсыз. Дүкен деректері (тапсырыстар, сомалар, сатып алушылар) қауымдастыққа ешқашан түспейді.",
  "settings.community.on": "Мені қауымдастықта көрсету",
  "settings.community.name": "Атауы",
  "settings.community.niche": "Бағыты",
  "settings.community.city": "Қала",
  "settings.community.about": "Немен айналысамын",
  "settings.community.links": "Сілтемелер (әр жолға біреуі, https:// деп басталады)",
  "settings.community.state.off": "Өшірулі: сізді басқа авторлар көрмейді.",
  "settings.community.state.visible": "Қосулы: басқа авторлар бұл профильді көреді.",
  "settings.community.state.hidden":
    "Платформа операторы сізді авторлар тізімінен жасырды. Қалғаны жұмыс істейді.",
  "settings.community.state.blocked":
    "Платформа операторы қауымдастыққа кіруді жапты. Қате болса, қолдау қызметіне жазыңыз.",
  "settings.community.reason": "Себебі: {reason}",
  "settings.community.ownerOnly": "Профильді дүкен иесі өзгертеді.",
  "err.community.noName": "Қауымдастықта көріну үшін атауды көрсетіңіз.",
  "err.community.oldPlatform": "Қауымдастық жаңа платформадағы дүкендерге қолжетімді.",
};

export const en: SectionDict<typeof ru> = {
  "settings.community.title": "Authors community",
  "settings.community.intro":
    "The community is where platform authors share experience. For now you can fill in a profile and give consent. While it is off, other authors cannot see you, and you read and write nothing. Shop data (orders, amounts, customers) never reaches the community.",
  "settings.community.on": "Show me in the community",
  "settings.community.name": "Name",
  "settings.community.niche": "Niche",
  "settings.community.city": "City",
  "settings.community.about": "What I do",
  "settings.community.links": "Links (one per line, starting with https://)",
  "settings.community.state.off": "Off: other authors cannot see you.",
  "settings.community.state.visible": "On: other authors see this profile.",
  "settings.community.state.hidden":
    "The platform operator hid you from the authors list. Everything else works.",
  "settings.community.state.blocked":
    "The platform operator closed community access for you. If this is a mistake, write to support.",
  "settings.community.reason": "Reason: {reason}",
  "settings.community.ownerOnly": "Only the shop owner can change the profile.",
  "err.community.noName": "To appear in the community, enter a name.",
  "err.community.oldPlatform": "The community is available to shops on the new platform.",
};

export const uz: SectionDict<typeof ru> = {
  "settings.community.title": "Mualliflar hamjamiyati",
  "settings.community.intro":
    "Hamjamiyat — platforma mualliflari tajriba almashadigan joy. Hozircha profilni toʻldirib, rozilik berishingiz mumkin. Oʻchiq boʻlsa, sizni boshqa mualliflar koʻrmaydi, siz ham hech narsa oʻqimaysiz va yozmaysiz. Doʻkon maʼlumotlari (buyurtmalar, summalar, xaridorlar) hamjamiyatga hech qachon tushmaydi.",
  "settings.community.on": "Meni hamjamiyatda koʻrsatish",
  "settings.community.name": "Nomi",
  "settings.community.niche": "Yoʻnalish",
  "settings.community.city": "Shahar",
  "settings.community.about": "Nima bilan shugʻullanaman",
  "settings.community.links": "Havolalar (har qatorda bittadan, https:// bilan boshlanadi)",
  "settings.community.state.off": "Oʻchiq: sizni boshqa mualliflar koʻrmaydi.",
  "settings.community.state.visible": "Yoqilgan: boshqa mualliflar bu profilni koʻradi.",
  "settings.community.state.hidden":
    "Platforma operatori sizni mualliflar roʻyxatidan yashirdi. Qolgani ishlaydi.",
  "settings.community.state.blocked":
    "Platforma operatori hamjamiyatga kirishni yopdi. Xato boʻlsa, qoʻllab-quvvatlashga yozing.",
  "settings.community.reason": "Sababi: {reason}",
  "settings.community.ownerOnly": "Profilni doʻkon egasi oʻzgartiradi.",
  "err.community.noName": "Hamjamiyatda koʻrinish uchun nomni kiriting.",
  "err.community.oldPlatform": "Hamjamiyat yangi platformadagi doʻkonlar uchun mavjud.",
};
