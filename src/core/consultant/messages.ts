import { isLocale, type Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";

/** Язык ответа покупателю: выбранный в диалоге, иначе язык магазина, иначе русский. */
export function buyerLocale(ctx: TenantContext, customer: Customer | null): Locale {
  const chosen = customer?.state.locale;
  if (isLocale(chosen)) return chosen;
  const fallback = ctx.tenant.settings.default_locale;
  return isLocale(fallback) ? fallback : "ru";
}

const HANDOFF: Record<Locale, string> = {
  ru: "Передам ваш вопрос менеджеру — он ответит в ближайшее время.",
  kk: "Сұрағыңызды менеджерге жіберемін — ол жақын арада жауап береді.",
  en: "I'll pass your question to a manager — they'll reply soon.",
  uz: "Savolingizni menejerga yuboraman — u tez orada javob beradi.",
};

const UNAVAILABLE: Record<Locale, string> = {
  ru: "Сейчас не могу ответить — передаю вопрос менеджеру, он напишет вам.",
  kk: "Қазір жауап бере алмаймын — сұрақты менеджерге жіберемін, ол сізге жазады.",
  en: "I can't answer right now — I'm passing your question to a manager, who will write to you.",
  uz: "Hozir javob bera olmayman — savolni menejerga yuboraman, u sizga yozadi.",
};

/** «Передам вопрос менеджеру» — предел, пауза, отказ модели. */
export const handoffReply = (locale: Locale): string => HANDOFF[locale];
/** «Сейчас не могу ответить» — сбой консультанта. */
export const unavailableReply = (locale: Locale): string => UNAVAILABLE[locale];

const PRICE_UNSURE: Record<Locale, string> = {
  ru: "Точную стоимость уточню у менеджера — он напишет вам в ближайшее время.",
  kk: "Нақты бағасын менеджерден нақтылаймын — ол жақын арада сізге жазады.",
  en: "I'll check the exact price with a manager — they'll write to you soon.",
  uz: "Aniq narxni menejerdan so‘rayman — u tez orada sizga yozadi.",
};

const LEAD_DONE: Record<Locale, string> = {
  ru: "Спасибо, всё записал и передал менеджеру — он свяжется с вами для подтверждения.",
  kk: "Рахмет, бәрін жазып алдым да менеджерге бердім — ол растау үшін сізбен байланысады.",
  en: "Thank you, I've noted everything and passed it to a manager — they'll contact you to confirm.",
  uz: "Rahmat, hammasini yozib oldim va menejerga uzatdim — u tasdiqlash uchun siz bilan bog‘lanadi.",
};

const DIALOG_HANDOFF: Record<Locale, string> = {
  ru: "Передаю диалог менеджеру — он ответит в ближайшее время.",
  kk: "Диалогты менеджерге беремін — ол жақын арада жауап береді.",
  en: "I'm handing this conversation to a manager — they'll reply soon.",
  uz: "Suhbatni menejerga uzataman — u tez orada javob beradi.",
};

const CLARIFY: Record<Locale, string> = {
  ru: "Уточните, пожалуйста, что именно вас интересует — подскажу.",
  kk: "Нақты не қызықтыратынын айтыңызшы — көмектесемін.",
  en: "Could you tell me what exactly you're interested in? I'll help.",
  uz: "Iltimos, aynan nima qiziqtirayotganini ayting — yordam beraman.",
};

const WHOLESALE: Record<Locale, string> = {
  ru: "Оптовые условия назовёт менеджер. Я передам ему ваш запрос, он скоро свяжется.",
  kk: "Көтерме шарттарын менеджер айтады. Сұрауыңызды оған беремін, ол жақын арада хабарласады.",
  en: "A manager will give you the wholesale terms. I'll pass your request on — they'll contact you soon.",
  uz: "Ulgurji shartlarni menejer aytadi. So‘rovingizni unga yetkazaman, u tez orada bog‘lanadi.",
};

/** Оптовый запрос: условия знает только менеджер (v1 WHOLESALE_REPLY). */
export const wholesaleReply = (locale: Locale): string => WHOLESALE[locale];

/** Цена не из каталога: ответ заменён, вопрос ушёл менеджеру. */
export const priceUnsureReply = (locale: Locale): string => PRICE_UNSURE[locale];
/** Заявка записана и передана менеджеру. */
export const leadDoneReply = (locale: Locale): string => LEAD_DONE[locale];
/** Модель передала диалог, не написав текста. */
export const dialogHandoffReply = (locale: Locale): string => DIALOG_HANDOFF[locale];
/** Модель ничего не ответила: просим уточнить. */
export const clarifyReply = (locale: Locale): string => CLARIFY[locale];

const UNANSWERED_TITLE: Record<Locale, string> = {
  ru: "Вопрос покупателя: консультант не ответил — ответьте сами",
  kk: "Сатып алушының сұрағы: кеңесші жауап бермеді — өзіңіз жауап беріңіз",
  en: "Customer question: the consultant didn't reply — please answer it yourself",
  uz: "Xaridor savoli: maslahatchi javob bermadi — o‘zingiz javob bering",
};

/** Продавцу (на его языке): вопрос остался без ответа консультанта. */
export const unansweredQuestionTitle = (locale: Locale): string => UNANSWERED_TITLE[locale];

const PRICELIST_HANDOFF: Record<Locale, string> = {
  ru: "Спасибо. Я передам ваш вопрос менеджеру, он скоро с вами свяжется.",
  kk: "Рахмет. Сұрағыңызды менеджерге жіберемін, ол жақын арада сізбен байланысады.",
  en: "Thank you. I'll pass your question to a manager, who will contact you soon.",
  uz: "Rahmat. Savolingizni menejerga yuboraman, u tez orada siz bilan bog‘lanadi.",
};

/** Консультант по прайсу передал вопрос, не написав фразы сам (v1 HANDOFF_TO_MANAGER_REPLY). */
export const pricelistHandoffReply = (locale: Locale): string => PRICELIST_HANDOFF[locale];

const RESET_PRICELIST: Record<Locale, string> = {
  ru: "Начнём заново. Что подсказать?",
  kk: "Қайта бастайық. Немен көмектесейін?",
  en: "Let's start over. How can I help?",
  uz: "Qaytadan boshlaymiz. Nima bilan yordam beray?",
};

const RESET: Record<Locale, (brand: string) => string> = {
  ru: (b) => `Начнём заново. Я консультант «${b}» — чем помочь?`,
  kk: (b) => `Қайта бастайық. Мен «${b}» кеңесшісімін — немен көмектесейін?`,
  en: (b) => `Let's start over. I'm the “${b}” consultant — how can I help?`,
  uz: (b) => `Qaytadan boshlaymiz. Men «${b}» maslahatchisiman — nima bilan yordam beray?`,
};

/** «Начнём заново»: покупатель сбросил диалог. С маркой — общий консультант, без — по прайсу. */
export const resetReply = (locale: Locale, brand?: string): string =>
  brand === undefined ? RESET_PRICELIST[locale] : RESET[locale](brand);

const FOLLOW_UP: Record<Locale, (model: string) => string> = {
  ru: (m) => `Остались вопросы по ${m}? Подскажу по размеру, цвету или доставке.`,
  kk: (m) => `${m} бойынша сұрақтарыңыз қалды ма? Өлшемі, түсі не жеткізу туралы айтып беремін.`,
  en: (m) => `Any questions left about ${m}? I can help with the size, color or delivery.`,
  uz: (m) =>
    `${m} bo‘yicha savollaringiz qoldimi? O‘lcham, rang yoki yetkazib berish bo‘yicha yordam beraman.`,
};

/** Напоминание замолчавшему покупателю о товаре (консультант по прайсу, follow-up). */
export const followUpLine = (locale: Locale, model: string): string => FOLLOW_UP[locale](model);

/* ── продавцу (на его языке, HTML Telegram) ─────────────────────────── */

const CONTACT_BUTTON: Record<
  Locale,
  { title: string; summary: string; hint: (hours: number) => string }
> = {
  ru: {
    title: "🙋 <b>Покупатель просит менеджера</b> (кнопка «Связаться с менеджером»)",
    summary: "Покупатель нажал «Связаться с менеджером» в Telegram",
    hint: (h) =>
      h === 0
        ? "Ответьте в «Чате» панели — консультант в этом диалоге молчит, пока вы не вернёте диалог боту."
        : `Ответьте в «Чате» панели — консультант в этом диалоге молчит ${h} ч.`,
  },
  kk: {
    title: "🙋 <b>Сатып алушы менеджерді сұрайды</b> («Менеджермен байланысу» батырмасы)",
    summary: "Сатып алушы Telegram-да «Менеджермен байланысу» батырмасын басты",
    hint: (h) =>
      h === 0
        ? "Панельдің «Чатында» жауап беріңіз — диалогты ботқа қайтарғанша кеңесші үндемейді."
        : `Панельдің «Чатында» жауап беріңіз — бұл диалогта кеңесші ${h} сағ үндемейді.`,
  },
  en: {
    title: "🙋 <b>Customer asks for a manager</b> (“Contact a manager” button)",
    summary: "The customer pressed “Contact a manager” in Telegram",
    hint: (h) =>
      h === 0
        ? "Reply in the panel “Chat” — the consultant stays silent in this dialogue until you hand it back to the bot."
        : `Reply in the panel “Chat” — the consultant stays silent in this dialogue for ${h} h.`,
  },
  uz: {
    title: "🙋 <b>Xaridor menejerni so‘rayapti</b> («Menejer bilan bog‘lanish» tugmasi)",
    summary: "Xaridor Telegram’da «Menejer bilan bog‘lanish» tugmasini bosdi",
    hint: (h) =>
      h === 0
        ? "Panel «Chat»ida javob bering — suhbatni botga qaytarmaguningizcha maslahatchi jim turadi."
        : `Panel «Chat»ida javob bering — bu suhbatda maslahatchi ${h} soat jim turadi.`,
  },
};

/** Кнопка «Связаться с менеджером» в Telegram у консультанта по прайсу — карточка продавцу. */
export const contactButtonText = (locale: Locale) => CONTACT_BUTTON[locale];

const REPLY_NOT_SENT: Record<Locale, string> = {
  ru: "⚠️ <b>Ответ консультанта не ушёл покупателю</b>",
  kk: "⚠️ <b>Кеңесшінің жауабы сатып алушыға жетпеді</b>",
  en: "⚠️ <b>The consultant's reply did not reach the customer</b>",
  uz: "⚠️ <b>Maslahatchi javobi xaridorga yetib bormadi</b>",
};

const REPLY_NOT_SENT_HINT: Record<Locale, string> = {
  ru: "Канал не подтвердил отправку (обрыв или ошибка). Повторно бот не отправляет: ответ мог и дойти. Проверьте переписку и ответьте сами.",
  kk: "Арна жіберуді растамады (үзіліс не қате). Бот қайта жібермейді: жауап жетуі де мүмкін. Хат алмасуды тексеріп, өзіңіз жауап беріңіз.",
  en: "The channel did not confirm delivery (connection drop or error). The bot does not resend: the reply may still have arrived. Check the conversation and reply yourself.",
  uz: "Kanal yuborilganini tasdiqlamadi (uzilish yoki xato). Bot qayta yubormaydi: javob yetib borgan bo‘lishi ham mumkin. Yozishmani tekshiring va o‘zingiz javob bering.",
};

const QUESTION: Record<Locale, string> = { ru: "Вопрос", kk: "Сұрақ", en: "Question", uz: "Savol" };

const BOT_ANSWERED: Record<Locale, string> = {
  ru: "Ответ бота",
  kk: "Бот жауабы",
  en: "Bot's reply",
  uz: "Bot javobi",
};

/** Продавцу: ответ консультанта не подтверждён каналом — заголовок и что делать. */
export const replyNotSentTitle = (locale: Locale): string => REPLY_NOT_SENT[locale];
export const replyNotSentHint = (locale: Locale): string => REPLY_NOT_SENT_HINT[locale];
/** Подписи «Вопрос» и «Ответ бота» в уведомлении о неотправленном ответе. */
export const questionLabel = (locale: Locale): string => QUESTION[locale];
export const botAnsweredLabel = (locale: Locale): string => BOT_ANSWERED[locale];

const RATE_STALE: Record<Locale, string> = {
  ru: "🟡 <b>Курс рубля для консультанта устарел или не получен.</b>\n\nПокупатели просят цены в рублях, но без свежего курса рубли не пересчитываются: консультант называет цены в тенге. Обновите курс в панели: «Прайс консультанта» → «Курс рубля».",
  kk: "🟡 <b>Кеңесшіге арналған рубль бағамы ескірген немесе алынбаған.</b>\n\nСатып алушылар бағаны рубльмен сұрайды, бірақ жаңа бағамсыз рубль есептелмейді: кеңесші бағаны теңгемен атайды. Бағамды панельде жаңартыңыз: «Кеңесші прайсы» → «Рубль бағамы».",
  en: "🟡 <b>The ruble rate for the consultant is out of date or missing.</b>\n\nCustomers ask for prices in rubles, but without a fresh rate rubles are not calculated: the consultant quotes prices in tenge. Update the rate in the panel: “Consultant price list” → “Ruble rate”.",
  uz: "🟡 <b>Maslahatchi uchun rubl kursi eskirgan yoki olinmagan.</b>\n\nXaridorlar narxni rublda so‘rayapti, ammo yangi kurssiz rubl hisoblanmaydi: maslahatchi narxlarni tengeda aytadi. Kursni panelda yangilang: «Maslahatchi narxnomasi» → «Rubl kursi».",
};

/** Продавцу, не чаще раза в сутки: рубли просят, а свежего курса нет (pricelist/rate-notice). */
export const rateStaleNotice = (locale: Locale): string => RATE_STALE[locale];
