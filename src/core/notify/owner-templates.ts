import type { Locale } from "@/core/i18n/locale";

/**
 * Готовые сообщения оператора владельцу магазина: на языке продавца, текст
 * правится перед отправкой. Названия шаблонов видит только оператор (по-русски).
 */
export type OwnerTemplateKey = "payment" | "checkin" | "feature";

export const OWNER_TEMPLATE_TITLES: Record<OwnerTemplateKey, string> = {
  payment: "Напоминание об оплате",
  checkin: "Давно не заходили — чем помочь?",
  feature: "Новая возможность для вас",
};

type Vars = { shop: string; paidUntil: string | null };

const TEXT: Record<OwnerTemplateKey, Record<Locale, (v: Vars) => string>> = {
  payment: {
    ru: (v) =>
      `Здравствуйте! Подписка FrogFlow для «${v.shop}» ${v.paidUntil ? `оплачена до ${v.paidUntil}` : "скоро закончится"}. Чтобы бот и витрина продолжили работать без перерыва, продлите её в админке: «Ваш план». Если нужна помощь с оплатой — ответьте на это сообщение.`,
    kk: (v) =>
      `Сәлеметсіз бе! «${v.shop}» үшін FrogFlow жазылымы ${v.paidUntil ? `${v.paidUntil} дейін төленген` : "жақында аяқталады"}. Бот пен витрина үзіліссіз жұмыс істеуі үшін оны әкімші панелінде ұзартыңыз: «Сіздің жоспарыңыз». Төлемге көмек керек болса, осы хабарламаға жауап беріңіз.`,
    en: (v) =>
      `Hello! The FrogFlow subscription for “${v.shop}” ${v.paidUntil ? `is paid until ${v.paidUntil}` : "is about to end"}. To keep the bot and the storefront running without a break, renew it in the admin panel: “Your plan”. If you need help with payment, just reply to this message.`,
    uz: (v) =>
      `Assalomu alaykum! «${v.shop}» uchun FrogFlow obunasi ${v.paidUntil ? `${v.paidUntil} gacha to‘langan` : "tez orada tugaydi"}. Bot va vitrina uzluksiz ishlashi uchun uni admin panelida uzaytiring: «Sizning rejangiz». To‘lovda yordam kerak bo‘lsa, shu xabarga javob bering.`,
  },
  checkin: {
    ru: (v) =>
      `Здравствуйте! Заметили, что в «${v.shop}» давно не заходили в админку. Что-то не получается или нужна помощь с настройкой? Ответьте на это сообщение — разберёмся вместе.`,
    kk: (v) =>
      `Сәлеметсіз бе! «${v.shop}» әкімші панеліне көптен бері кірмегеніңізді байқадық. Бірдеңе шықпай жатыр ма немесе баптауға көмек керек пе? Осы хабарламаға жауап беріңіз — бірге шешеміз.`,
    en: (v) =>
      `Hello! We noticed you haven't opened the admin panel of “${v.shop}” for a while. Is something not working, or do you need help with setup? Reply to this message and we'll sort it out together.`,
    uz: (v) =>
      `Assalomu alaykum! «${v.shop}» admin paneliga anchadan beri kirmaganingizni sezdik. Biror narsa chiqmayaptimi yoki sozlashda yordam kerakmi? Shu xabarga javob bering — birga hal qilamiz.`,
  },
  feature: {
    ru: (v) =>
      `Здравствуйте! В FrogFlow появилась новая возможность, которая может пригодиться «${v.shop}»: загляните в админку — раздел «Модули». Если хотите, подключим и поможем настроить.`,
    kk: (v) =>
      `Сәлеметсіз бе! FrogFlow-да «${v.shop}» үшін пайдалы болуы мүмкін жаңа мүмкіндік пайда болды: әкімші панелінің «Модульдер» бөлімін қараңыз. Қаласаңыз, қосып, баптауға көмектесеміз.`,
    en: (v) =>
      `Hello! FrogFlow has a new feature that may be useful for “${v.shop}”: take a look in the admin panel, “Modules” section. If you like, we'll switch it on and help you set it up.`,
    uz: (v) =>
      `Assalomu alaykum! FrogFlow'da «${v.shop}» uchun foydali bo‘lishi mumkin bo‘lgan yangi imkoniyat paydo bo‘ldi: admin panelidagi «Modullar» bo‘limini ko‘ring. Xohlasangiz, ulab, sozlashda yordam beramiz.`,
  },
};

export function ownerTemplate(key: OwnerTemplateKey, locale: Locale, vars: Vars): string {
  return TEXT[key][locale](vars);
}

export function ownerTemplates(
  locale: Locale,
  vars: Vars,
): Array<{ key: OwnerTemplateKey; title: string; text: string }> {
  return (Object.keys(TEXT) as OwnerTemplateKey[]).map((key) => ({
    key,
    title: OWNER_TEMPLATE_TITLES[key],
    text: ownerTemplate(key, locale, vars),
  }));
}
