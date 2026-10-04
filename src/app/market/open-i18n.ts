import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";

/** Страница «Открыть свой магазин» (/market/open) на 4 языках. Русский — источник ключей. */
const ru = {
  "meta.title": "Открыть свой магазин на FrogFlow",
  "meta.description":
    "Оставьте заявку: мы создадим магазин по шаблону вашей ниши и пришлём доступ.",
  title: "Открыть свой магазин",
  lead: "Выберите, что продаёте, и тариф, оставьте контакт. Мы создадим магазин по шаблону ниши и пришлём доступ. Деньги сейчас не списываются: оплата, как у всех клиентов, по счёту.",
  "step.niche": "1. Что продаёте",
  "step.tier": "2. Тариф",
  "step.contact": "3. Как с вами связаться",
  "tier.basic": "Basic",
  "tier.pro": "Pro",
  "tier.business": "Business",
  "tier.price": "Подключение {setup}, затем {monthly} в месяц",
  "field.name": "Название магазина",
  "field.phone": "Телефон (WhatsApp)",
  "field.email": "Почта",
  "field.instagram": "Instagram",
  "field.city": "Город",
  "field.comment": "Что важно знать (по желанию)",
  "contact.hint": "Нужен хотя бы один способ связи: телефон, почта или Instagram.",
  submit: "Отправить заявку",
  "done.title": "Заявка принята",
  "done.text":
    "Мы свяжемся с вами по указанному контакту, создадим магазин и пришлём доступ. Если заявка уже была сегодня, второй раз отправлять не нужно.",
  "err.niche": "Выберите, что продаёте.",
  "err.tier": "Выберите тариф.",
  "err.name": "Укажите название магазина.",
  "err.contact": "Укажите телефон, почту или Instagram в правильном виде.",
  "err.ip": "С этого адреса сегодня уже оставили заявки. Попробуйте завтра или напишите нам.",
  "err.total": "Приём заявок на сегодня временно закрыт. Попробуйте завтра.",
  "err.refresh": "Проверка устарела: обновите страницу и отправьте ещё раз.",
  "err.fast": "Слишком быстро: проверьте поля и отправьте ещё раз.",
  "err.failed": "Не удалось отправить заявку. Попробуйте позже.",
  "link.open": "Открыть свой магазин",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "FrogFlow-та өз дүкеніңізді ашыңыз",
  "meta.description":
    "Өтінім қалдырыңыз: біз ниша үлгісі бойынша дүкен жасап, қолжетімділік жібереміз.",
  title: "Өз дүкеніңізді ашыңыз",
  lead: "Не сататыныңызды және тарифті таңдап, байланыс қалдырыңыз. Біз ниша үлгісі бойынша дүкен жасап, қолжетімділік жібереміз. Ақша қазір алынбайды: төлем, барлық клиенттердегідей, шот бойынша.",
  "step.niche": "1. Не сатасыз",
  "step.tier": "2. Тариф",
  "step.contact": "3. Сізбен қалай байланысамыз",
  "tier.basic": "Basic",
  "tier.pro": "Pro",
  "tier.business": "Business",
  "tier.price": "Қосылу {setup}, одан кейін айына {monthly}",
  "field.name": "Дүкен атауы",
  "field.phone": "Телефон нөмірі (WhatsApp)",
  "field.email": "Пошта",
  "field.instagram": "Instagram",
  "field.city": "Қала",
  "field.comment": "Білу маңызды (қалауыңызша)",
  "contact.hint": "Кемінде бір байланыс тәсілі керек: телефон, пошта немесе Instagram.",
  submit: "Өтінім жіберу",
  "done.title": "Өтінім қабылданды",
  "done.text":
    "Біз көрсетілген байланыс бойынша хабарласып, дүкен жасап, қолжетімділік жібереміз. Өтінім бүгін бұрын берілген болса, қайта жіберудің қажеті жоқ.",
  "err.niche": "Не сататыныңызды таңдаңыз.",
  "err.tier": "Тарифті таңдаңыз.",
  "err.name": "Дүкен атауын көрсетіңіз.",
  "err.contact": "Телефонды, поштаны немесе Instagram-ды дұрыс түрде көрсетіңіз.",
  "err.ip": "Бұл мекенжайдан бүгін өтінімдер қалдырылды. Ертең қайталаңыз немесе бізге жазыңыз.",
  "err.total": "Бүгінге өтінім қабылдау уақытша жабық. Ертең қайталаңыз.",
  "err.refresh": "Тексеру ескірді: бетті жаңартып, қайта жіберіңіз.",
  "err.fast": "Тым жылдам: өрістерді тексеріп, қайта жіберіңіз.",
  "err.failed": "Өтінімді жіберу мүмкін болмады. Кейінірек қайталаңыз.",
  "link.open": "Өз дүкеніңізді ашу",
};

const en: Record<Key, string> = {
  "meta.title": "Open your own shop on FrogFlow",
  "meta.description":
    "Leave a request: we will create a shop from your niche template and send you access.",
  title: "Open your own shop",
  lead: "Choose what you sell and a plan, leave a contact. We will create a shop from the niche template and send you access. Nothing is charged now: payment is by invoice, like for every client.",
  "step.niche": "1. What you sell",
  "step.tier": "2. Plan",
  "step.contact": "3. How to reach you",
  "tier.basic": "Basic",
  "tier.pro": "Pro",
  "tier.business": "Business",
  "tier.price": "Setup {setup}, then {monthly} per month",
  "field.name": "Shop name",
  "field.phone": "Phone (WhatsApp)",
  "field.email": "Email",
  "field.instagram": "Instagram",
  "field.city": "City",
  "field.comment": "Anything we should know (optional)",
  "contact.hint": "At least one way to reach you: phone, email or Instagram.",
  submit: "Send request",
  "done.title": "Request received",
  "done.text":
    "We will contact you, create the shop and send you access. If you already sent a request today, there is no need to send it again.",
  "err.niche": "Choose what you sell.",
  "err.tier": "Choose a plan.",
  "err.name": "Enter the shop name.",
  "err.contact": "Enter a phone, email or Instagram in a valid format.",
  "err.ip": "Requests were already sent from this address today. Try tomorrow or write to us.",
  "err.total": "Requests are temporarily closed for today. Please try tomorrow.",
  "err.refresh": "The check has expired: reload the page and send again.",
  "err.fast": "Too fast: check the fields and send again.",
  "err.failed": "Could not send the request. Please try later.",
  "link.open": "Open your own shop",
};

const uz: Record<Key, string> = {
  "meta.title": "FrogFlow’da o‘z do‘koningizni oching",
  "meta.description":
    "Ariza qoldiring: biz soha namunasi bo‘yicha do‘kon yaratib, kirish ma’lumotini yuboramiz.",
  title: "O‘z do‘koningizni oching",
  lead: "Nima sotishingizni va tarifni tanlang, aloqa qoldiring. Biz soha namunasi bo‘yicha do‘kon yaratib, kirish ma’lumotini yuboramiz. Hozir pul yechilmaydi: to‘lov, barcha mijozlardagidek, hisob bo‘yicha.",
  "step.niche": "1. Nima sotasiz",
  "step.tier": "2. Tarif",
  "step.contact": "3. Siz bilan qanday bog‘lanamiz",
  "tier.basic": "Basic",
  "tier.pro": "Pro",
  "tier.business": "Business",
  "tier.price": "Ulanish {setup}, keyin oyiga {monthly}",
  "field.name": "Do‘kon nomi",
  "field.phone": "Telefon (WhatsApp)",
  "field.email": "Pochta",
  "field.instagram": "Instagram",
  "field.city": "Shahar",
  "field.comment": "Bilish muhim (xohlasangiz)",
  "contact.hint": "Kamida bitta aloqa usuli kerak: telefon, pochta yoki Instagram.",
  submit: "Ariza yuborish",
  "done.title": "Ariza qabul qilindi",
  "done.text":
    "Biz ko‘rsatilgan aloqa orqali bog‘lanamiz, do‘kon yaratamiz va kirish ma’lumotini yuboramiz. Ariza bugun yuborilgan bo‘lsa, qayta yuborish shart emas.",
  "err.niche": "Nima sotishingizni tanlang.",
  "err.tier": "Tarifni tanlang.",
  "err.name": "Do‘kon nomini kiriting.",
  "err.contact": "Telefon, pochta yoki Instagram’ni to‘g‘ri ko‘rinishda kiriting.",
  "err.ip": "Bu manzildan bugun arizalar qoldirilgan. Ertaga urinib ko‘ring yoki bizga yozing.",
  "err.total": "Bugun arizalar qabul qilish vaqtincha yopiq. Ertaga urinib ko‘ring.",
  "err.refresh": "Tekshiruv eskirdi: sahifani yangilab, qayta yuboring.",
  "err.fast": "Juda tez: maydonlarni tekshirib, qayta yuboring.",
  "err.failed": "Arizani yuborib bo‘lmadi. Keyinroq urinib ko‘ring.",
  "link.open": "O‘z do‘koningizni ochish",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export type OpenKey = Key;
export const OPEN_KEYS = Object.keys(ru) as Key[];

export function openT(locale: Locale) {
  const d = DICTS[locale] ?? ru;
  return (key: Key, vars?: UserErrorVars) => fill(d[key] ?? ru[key], vars);
}
