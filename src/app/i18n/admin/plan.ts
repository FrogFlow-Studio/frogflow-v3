import type { SectionDict } from "../section";

/** «Ваш план» в разделе модулей: тариф, расход ИИ, переход и каналы сверх плана. */
export const ru = {
  "plan.title": "Ваш план",
  "plan.custom": "Индивидуальные условия по договору",
  "plan.perMonth": "{price} ₸ в месяц",
  "plan.perYear": "оплата за год: 12 месяцев по цене 10",
  "plan.trial": "Пробный период до {date}",
  "plan.usage": "ИИ в этом месяце",
  "plan.dialogs": "Диалоги консультанта",
  "plan.receipts": "Проверки чеков",
  "plan.of": "{used} из {limit}",
  "plan.unlimited": "{used} · без лимита",
  "plan.limitHint":
    "Сверх лимита новые диалоги уходят менеджеру, чеки — вам на ручную проверку. Лимит обновляется 1-го числа.",
  "plan.upgradeTo": "Перейти на {tier}",
  "plan.upgradeHint": "{price} ₸ в месяц, подключение {connection} ₸",
  "plan.addon": "{channel} сверх плана",
  "plan.addAddon": "Подключить",
  "plan.requested": "Заявка отправлена",
  "plan.inTier": "в {tier}",
  "plan.included": "в вашем плане",
} as const;

export const kk: SectionDict<typeof ru> = {
  "plan.title": "Сіздің жоспарыңыз",
  "plan.custom": "Шарт бойынша жеке шарттар",
  "plan.perMonth": "айына {price} ₸",
  "plan.perYear": "жылдық төлем: 10 айдың бағасымен 12 ай",
  "plan.trial": "Сынақ кезеңі {date} дейін",
  "plan.usage": "Осы айдағы ЖИ",
  "plan.dialogs": "Кеңесші диалогтары",
  "plan.receipts": "Чек тексерулері",
  "plan.of": "{used} / {limit}",
  "plan.unlimited": "{used} · шектеусіз",
  "plan.limitHint":
    "Шектен тыс жаңа диалогтар менеджерге, чектер сізге қолмен тексеруге кетеді. Шек айдың 1-інде жаңарады.",
  "plan.upgradeTo": "{tier} жоспарына өту",
  "plan.upgradeHint": "айына {price} ₸, қосу {connection} ₸",
  "plan.addon": "Жоспардан тыс {channel}",
  "plan.addAddon": "Қосу",
  "plan.requested": "Өтінім жіберілді",
  "plan.inTier": "{tier} ішінде",
  "plan.included": "жоспарыңызда бар",
};

export const en: SectionDict<typeof ru> = {
  "plan.title": "Your plan",
  "plan.custom": "Custom terms under contract",
  "plan.perMonth": "{price} ₸ per month",
  "plan.perYear": "billed yearly: 12 months for the price of 10",
  "plan.trial": "Trial until {date}",
  "plan.usage": "AI this month",
  "plan.dialogs": "Consultant dialogs",
  "plan.receipts": "Receipt checks",
  "plan.of": "{used} of {limit}",
  "plan.unlimited": "{used} · unlimited",
  "plan.limitHint":
    "Over the limit, new dialogs go to a manager and receipts come to you for manual checking. The limit resets on the 1st.",
  "plan.upgradeTo": "Upgrade to {tier}",
  "plan.upgradeHint": "{price} ₸ per month, setup {connection} ₸",
  "plan.addon": "{channel} on top of the plan",
  "plan.addAddon": "Add",
  "plan.requested": "Request sent",
  "plan.inTier": "in {tier}",
  "plan.included": "in your plan",
};

export const uz: SectionDict<typeof ru> = {
  "plan.title": "Sizning rejangiz",
  "plan.custom": "Shartnoma boʻyicha individual shartlar",
  "plan.perMonth": "oyiga {price} ₸",
  "plan.perYear": "yillik toʻlov: 12 oy 10 oy narxida",
  "plan.trial": "Sinov muddati {date} gacha",
  "plan.usage": "Shu oydagi SI",
  "plan.dialogs": "Maslahatchi dialoglari",
  "plan.receipts": "Chek tekshiruvlari",
  "plan.of": "{used} / {limit}",
  "plan.unlimited": "{used} · cheklovsiz",
  "plan.limitHint":
    "Limitdan oshganda yangi dialoglar menejerga, cheklar sizga qoʻlda tekshirish uchun ketadi. Limit har oyning 1-sanasida yangilanadi.",
  "plan.upgradeTo": "{tier} rejasiga oʻtish",
  "plan.upgradeHint": "oyiga {price} ₸, ulanish {connection} ₸",
  "plan.addon": "Rejadan tashqari {channel}",
  "plan.addAddon": "Ulash",
  "plan.requested": "Ariza yuborildi",
  "plan.inTier": "{tier} ichida",
  "plan.included": "rejangizda bor",
};
