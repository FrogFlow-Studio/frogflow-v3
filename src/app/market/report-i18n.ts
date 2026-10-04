import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";

/** Страница «Пожаловаться» (/market/report) на 4 языках. Русский — источник ключей. */
const ru = {
  "meta.title": "Пожаловаться на магазин",
  title: "Пожаловаться",
  "about.shop": "Магазин: {shop}",
  "about.product": "Магазин: {shop}. Товар: {product}",
  lead: "Опишите, что не так. Жалобу прочитает команда площадки; магазин её не увидит. Контакты оставлять не нужно.",
  "field.reason": "Что случилось",
  "reason.fraud": "Мошенничество или обман",
  "reason.not_delivered": "Оплатил, но заказ не получил",
  "reason.prohibited": "Запрещённый товар или услуга",
  "reason.copyright": "Чужие материалы без разрешения",
  "reason.other": "Другое",
  "field.text": "Подробности",
  "text.hint": "Для причины «Другое» опишите ситуацию хотя бы в нескольких словах.",
  submit: "Отправить жалобу",
  "done.title": "Жалоба принята",
  "done.text":
    "Спасибо. Команда площадки её посмотрит и при необходимости скроет магазин с площадки. Если вы уже жаловались сегодня, повторять не нужно.",
  "err.text": "Опишите ситуацию хотя бы в нескольких словах.",
  "err.unknown": "Этого магазина или товара на площадке нет.",
  "err.ip": "С этого адреса сегодня уже отправили жалобы. Попробуйте завтра или напишите нам.",
  "err.refresh": "Проверка устарела: обновите страницу и отправьте ещё раз.",
  "err.fast": "Слишком быстро: проверьте поля и отправьте ещё раз.",
  "err.failed": "Не удалось отправить жалобу. Попробуйте позже.",
  "missing.title": "Магазин не найден",
  "missing.text": "Жалобу можно отправить только на магазин, который виден на площадке.",
  back: "К магазинам",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "Дүкенге шағымдану",
  title: "Шағымдану",
  "about.shop": "Дүкен: {shop}",
  "about.product": "Дүкен: {shop}. Тауар: {product}",
  lead: "Не дұрыс емес екенін сипаттаңыз. Шағымды алаң командасы оқиды; дүкен оны көрмейді. Байланыс деректерін қалдырудың қажеті жоқ.",
  "field.reason": "Не болды",
  "reason.fraud": "Алаяқтық немесе алдау",
  "reason.not_delivered": "Төледім, бірақ тапсырысты алмадым",
  "reason.prohibited": "Тыйым салынған тауар немесе қызмет",
  "reason.copyright": "Біреудің материалдары рұқсатсыз",
  "reason.other": "Басқа",
  "field.text": "Мәліметтер",
  "text.hint": "«Басқа» себебі үшін жағдайды кемінде бірнеше сөзбен сипаттаңыз.",
  submit: "Шағымды жіберу",
  "done.title": "Шағым қабылданды",
  "done.text":
    "Рақмет. Алаң командасы оны қарап, қажет болса дүкенді алаңнан жасырады. Бүгін шағымдансаңыз, қайталаудың қажеті жоқ.",
  "err.text": "Жағдайды кемінде бірнеше сөзбен сипаттаңыз.",
  "err.unknown": "Алаңда мұндай дүкен немесе тауар жоқ.",
  "err.ip": "Бұл мекенжайдан бүгін шағымдар жіберілген. Ертең байқап көріңіз немесе бізге жазыңыз.",
  "err.refresh": "Тексеру ескірді: бетті жаңартып, қайта жіберіңіз.",
  "err.fast": "Тым жылдам: өрістерді тексеріп, қайта жіберіңіз.",
  "err.failed": "Шағымды жіберу мүмкін болмады. Кейінірек қайталап көріңіз.",
  "missing.title": "Дүкен табылмады",
  "missing.text": "Шағымды тек алаңда көрінетін дүкенге жіберуге болады.",
  back: "Дүкендерге",
};

const en: Record<Key, string> = {
  "meta.title": "Report a shop",
  title: "Report",
  "about.shop": "Shop: {shop}",
  "about.product": "Shop: {shop}. Product: {product}",
  lead: "Tell us what is wrong. The marketplace team reads the report; the shop will not see it. You do not need to leave contact details.",
  "field.reason": "What happened",
  "reason.fraud": "Fraud or deception",
  "reason.not_delivered": "I paid but did not get the order",
  "reason.prohibited": "Prohibited product or service",
  "reason.copyright": "Someone else’s material without permission",
  "reason.other": "Other",
  "field.text": "Details",
  "text.hint": "For “Other”, describe the situation in at least a few words.",
  submit: "Send report",
  "done.title": "Report received",
  "done.text":
    "Thank you. The marketplace team will look at it and, if needed, hide the shop from the marketplace. If you already reported today, there is no need to repeat it.",
  "err.text": "Describe the situation in at least a few words.",
  "err.unknown": "There is no such shop or product on the marketplace.",
  "err.ip": "Reports were already sent from this address today. Try tomorrow or write to us.",
  "err.refresh": "The check has expired: reload the page and send again.",
  "err.fast": "Too fast: check the fields and send again.",
  "err.failed": "Could not send the report. Please try later.",
  "missing.title": "Shop not found",
  "missing.text": "You can only report a shop that is visible on the marketplace.",
  back: "Back to shops",
};

const uz: Record<Key, string> = {
  "meta.title": "Do‘kon ustidan shikoyat",
  title: "Shikoyat qilish",
  "about.shop": "Do‘kon: {shop}",
  "about.product": "Do‘kon: {shop}. Mahsulot: {product}",
  lead: "Nima noto‘g‘ri ekanini yozing. Shikoyatni maydon jamoasi o‘qiydi; do‘kon uni ko‘rmaydi. Aloqa ma’lumotini qoldirish shart emas.",
  "field.reason": "Nima bo‘ldi",
  "reason.fraud": "Firibgarlik yoki aldov",
  "reason.not_delivered": "To‘ladim, lekin buyurtmani olmadim",
  "reason.prohibited": "Taqiqlangan mahsulot yoki xizmat",
  "reason.copyright": "Boshqa birovning materiallari ruxsatsiz",
  "reason.other": "Boshqa",
  "field.text": "Tafsilotlar",
  "text.hint": "«Boshqa» sababi uchun vaziyatni kamida bir necha so‘z bilan yozing.",
  submit: "Shikoyatni yuborish",
  "done.title": "Shikoyat qabul qilindi",
  "done.text":
    "Rahmat. Maydon jamoasi uni ko‘rib chiqadi va kerak bo‘lsa do‘konni maydondan yashiradi. Bugun shikoyat qilgan bo‘lsangiz, qaytarish shart emas.",
  "err.text": "Vaziyatni kamida bir necha so‘z bilan yozing.",
  "err.unknown": "Maydonda bunday do‘kon yoki mahsulot yo‘q.",
  "err.ip": "Bu manzildan bugun shikoyatlar yuborilgan. Ertaga urinib ko‘ring yoki bizga yozing.",
  "err.refresh": "Tekshiruv eskirdi: sahifani yangilab, qayta yuboring.",
  "err.fast": "Juda tez: maydonlarni tekshirib, qayta yuboring.",
  "err.failed": "Shikoyatni yuborib bo‘lmadi. Keyinroq urinib ko‘ring.",
  "missing.title": "Do‘kon topilmadi",
  "missing.text": "Shikoyatni faqat maydonda ko‘rinadigan do‘konga yuborish mumkin.",
  back: "Do‘konlarga",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export type ReportKey = Key;
export const REPORT_KEYS = Object.keys(ru) as Key[];

export function reportT(locale: Locale) {
  const d = DICTS[locale] ?? ru;
  return (key: Key, vars?: UserErrorVars) => fill(d[key] ?? ru[key], vars);
}
