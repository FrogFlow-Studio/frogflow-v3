import type { Locale } from "@/core/i18n/locale";

/**
 * Сохранённые адреса покупателя на витрине (К5): «Мои заказы» и оформление. Отдельный маленький
 * словарь на ru, kk, en, uz, чтобы не трогать общий словарь витрины.
 */
const ru = {
  "addr.title": "Мои адреса",
  "addr.hint": "Адреса доставки, которые вы сохранили. При оформлении заказа их можно выбрать.",
  "addr.empty": "Сохранённых адресов пока нет.",
  "addr.add": "Добавить адрес",
  "addr.placeholder": "Город, улица, дом, квартира",
  "addr.save": "Сохранить",
  "addr.edit": "Изменить",
  "addr.delete": "Удалить",
  "addr.cancel": "Отмена",
  "addr.full": "Можно сохранить не больше {n} адресов. Удалите ненужный.",
  "addr.bad": "Введите адрес: не пустой и не длиннее {n} знаков.",
  "addr.failed": "Не получилось сохранить. Попробуйте ещё раз.",
  "addr.pick": "Мои адреса",
  "addr.pickNone": "Выбрать сохранённый адрес",
  "addr.remember": "Запомнить этот адрес",
} as const;

type Dict = Record<keyof typeof ru, string>;

const kk: Dict = {
  "addr.title": "Менің мекенжайларым",
  "addr.hint": "Сіз сақтаған жеткізу мекенжайлары. Тапсырыс беру кезінде таңдауға болады.",
  "addr.empty": "Сақталған мекенжайлар әзір жоқ.",
  "addr.add": "Мекенжай қосу",
  "addr.placeholder": "Қала, көше, үй, пәтер",
  "addr.save": "Сақтау",
  "addr.edit": "Өзгерту",
  "addr.delete": "Жою",
  "addr.cancel": "Болдырмау",
  "addr.full": "{n} мекенжайдан артық сақтауға болмайды. Қажетсізін жойыңыз.",
  "addr.bad": "Мекенжайды енгізіңіз: бос емес және {n} таңбадан ұзын емес.",
  "addr.failed": "Сақтау мүмкін болмады. Қайталап көріңіз.",
  "addr.pick": "Менің мекенжайларым",
  "addr.pickNone": "Сақталған мекенжайды таңдау",
  "addr.remember": "Осы мекенжайды есте сақтау",
};

const en: Dict = {
  "addr.title": "My addresses",
  "addr.hint": "Delivery addresses you saved. You can pick one at checkout.",
  "addr.empty": "No saved addresses yet.",
  "addr.add": "Add an address",
  "addr.placeholder": "City, street, building, apartment",
  "addr.save": "Save",
  "addr.edit": "Edit",
  "addr.delete": "Delete",
  "addr.cancel": "Cancel",
  "addr.full": "You can save up to {n} addresses. Delete one you no longer need.",
  "addr.bad": "Enter an address: not empty and at most {n} characters.",
  "addr.failed": "Could not save. Please try again.",
  "addr.pick": "My addresses",
  "addr.pickNone": "Choose a saved address",
  "addr.remember": "Remember this address",
};

const uz: Dict = {
  "addr.title": "Manzillarim",
  "addr.hint": "Siz saqlagan yetkazib berish manzillari. Buyurtma berishda tanlash mumkin.",
  "addr.empty": "Saqlangan manzillar hozircha yoʻq.",
  "addr.add": "Manzil qoʻshish",
  "addr.placeholder": "Shahar, koʻcha, uy, xonadon",
  "addr.save": "Saqlash",
  "addr.edit": "Oʻzgartirish",
  "addr.delete": "Oʻchirish",
  "addr.cancel": "Bekor qilish",
  "addr.full": "{n} tadan ortiq manzil saqlab boʻlmaydi. Keraksizini oʻchiring.",
  "addr.bad": "Manzilni kiriting: boʻsh emas va {n} belgidan uzun emas.",
  "addr.failed": "Saqlab boʻlmadi. Qayta urinib koʻring.",
  "addr.pick": "Manzillarim",
  "addr.pickNone": "Saqlangan manzilni tanlash",
  "addr.remember": "Bu manzilni eslab qolish",
};

const DICTS: Record<Locale, Dict> = { ru, kk, en, uz };

export type AddrKey = keyof typeof ru;
export const ADDR_KEYS = Object.keys(ru) as AddrKey[];

export function addrT(locale: Locale) {
  const dict = DICTS[locale] ?? ru;
  return (key: AddrKey, vars?: Record<string, string | number>) => {
    let s = dict[key] ?? ru[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
