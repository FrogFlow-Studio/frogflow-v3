import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";

/** Публичная страница /status на 4 языках. Русский — источник ключей. */
const ru = {
  "meta.title": "Статус FrogFlow",
  "title.ok": "Все системы работают",
  "title.degraded": "Есть перебои",
  "title.unknown": "Нет данных",
  updated: "Обновлено {date}",
  "state.ok": "Работает",
  "state.degraded": "Сбои",
  "state.unknown": "Нет данных",
  lastFail: "Последний сбой: {date}",
  "service.telegram": "Боты Telegram",
  "service.instagram": "Instagram",
  "service.whatsapp": "WhatsApp",
  "service.payments": "Счета и оплата подписок",
  "service.storefront": "Витрины и панели",
  "service.broadcasts": "Рассылки и уведомления",
  "service.reminders": "Напоминания покупателям",
  "service.vip": "VIP-подписки",
  "service.daily": "Ежедневные задачи",
  note: "Страница не показывает данные клиентов. «Нет данных» — мы не смогли это проверить, а не «всё хорошо».",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "FrogFlow күйі",
  "title.ok": "Барлық жүйелер жұмыс істеп тұр",
  "title.degraded": "Іркілістер бар",
  "title.unknown": "Деректер жоқ",
  updated: "Жаңартылды: {date}",
  "state.ok": "Жұмыс істеп тұр",
  "state.degraded": "Іркілістер",
  "state.unknown": "Деректер жоқ",
  lastFail: "Соңғы іркіліс: {date}",
  "service.telegram": "Telegram боттары",
  "service.instagram": "Instagram",
  "service.whatsapp": "WhatsApp",
  "service.payments": "Шоттар және жазылым төлемі",
  "service.storefront": "Витриналар мен панельдер",
  "service.broadcasts": "Таратулар мен хабарламалар",
  "service.reminders": "Сатып алушыларға еске салулар",
  "service.vip": "VIP-жазылымдар",
  "service.daily": "Күнделікті тапсырмалар",
  note: "Бет клиенттердің деректерін көрсетпейді. «Деректер жоқ» — біз оны тексере алмадық, «бәрі жақсы» дегенді білдірмейді.",
};

const en: Record<Key, string> = {
  "meta.title": "FrogFlow status",
  "title.ok": "All systems operational",
  "title.degraded": "Some services are disrupted",
  "title.unknown": "No data",
  updated: "Updated {date}",
  "state.ok": "Working",
  "state.degraded": "Issues",
  "state.unknown": "No data",
  lastFail: "Last issue: {date}",
  "service.telegram": "Telegram bots",
  "service.instagram": "Instagram",
  "service.whatsapp": "WhatsApp",
  "service.payments": "Invoices and subscription payments",
  "service.storefront": "Storefronts and panels",
  "service.broadcasts": "Broadcasts and notifications",
  "service.reminders": "Customer reminders",
  "service.vip": "VIP subscriptions",
  "service.daily": "Daily jobs",
  note: "This page shows no customer data. “No data” means we could not check, not that everything is fine.",
};

const uz: Record<Key, string> = {
  "meta.title": "FrogFlow holati",
  "title.ok": "Barcha tizimlar ishlayapti",
  "title.degraded": "Uzilishlar bor",
  "title.unknown": "Ma’lumot yo‘q",
  updated: "Yangilandi: {date}",
  "state.ok": "Ishlayapti",
  "state.degraded": "Nosozliklar",
  "state.unknown": "Ma’lumot yo‘q",
  lastFail: "Oxirgi nosozlik: {date}",
  "service.telegram": "Telegram botlari",
  "service.instagram": "Instagram",
  "service.whatsapp": "WhatsApp",
  "service.payments": "Hisoblar va obuna to‘lovlari",
  "service.storefront": "Vitrinalar va panellar",
  "service.broadcasts": "Xabarnomalar va ro‘yxatlar",
  "service.reminders": "Xaridorlarga eslatmalar",
  "service.vip": "VIP-obunalar",
  "service.daily": "Kundalik vazifalar",
  note: "Sahifa mijozlar ma’lumotini ko‘rsatmaydi. «Ma’lumot yo‘q» — tekshira olmadik degani, «hammasi yaxshi» degani emas.",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export function statusT(locale: Locale) {
  const d = DICTS[locale];
  return (key: Key, vars?: UserErrorVars) => fill(d[key], vars);
}
