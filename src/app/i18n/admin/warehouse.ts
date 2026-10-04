import type { SectionDict } from "../section";

/** Раздел «Склад» (модуль warehouse): поставщики, приход, списание. */
export const ru = {
  "warehouse.nav": "Склад",
  "warehouse.title": "Склад",
  "warehouse.subtitle":
    "Поставщики и движение остатка. Каждое изменение остатка остаётся в истории товара.",
  "warehouse.back": "← Склад",
  "warehouse.hub.suppliers": "Поставщики",
  "warehouse.hub.suppliersHint": "Кто что привозит: контакты и основной поставщик каждого товара.",
  "suppliers.title": "Поставщики",
  "suppliers.subtitle": "Основной поставщик товара выбирается в карточке самого товара.",
  "suppliers.add": "Добавить поставщика",
  "suppliers.name": "Название",
  "suppliers.contact": "Контактное лицо",
  "suppliers.phone": "Телефон",
  "suppliers.note": "Заметка",
  "suppliers.save": "Сохранить",
  "suppliers.cancel": "Отмена",
  "suppliers.edit": "Изменить",
  "suppliers.remove": "Удалить",
  "suppliers.removeConfirm": "Удалить поставщика «{name}»? Товаров с ним: {n} — он снимется с них.",
  "suppliers.empty": "Поставщиков пока нет.",
  "suppliers.products": "товаров: {n}",
  "product.supplier.card": "Поставщик",
  "product.supplier.none": "Не выбран",
  "product.supplier.hint": "Основной поставщик этого товара. Список — в разделе «Склад».",
  "product.supplier.empty": "Поставщиков ещё нет — добавьте их в разделе «Склад».",
};

export const kk: SectionDict<typeof ru> = {
  "warehouse.nav": "Қойма",
  "warehouse.title": "Қойма",
  "warehouse.subtitle":
    "Жеткізушілер және қалдық қозғалысы. Қалдықтың әр өзгерісі тауардың тарихында сақталады.",
  "warehouse.back": "← Қойма",
  "warehouse.hub.suppliers": "Жеткізушілер",
  "warehouse.hub.suppliersHint":
    "Кім не әкеледі: байланыстар және әр тауардың негізгі жеткізушісі.",
  "suppliers.title": "Жеткізушілер",
  "suppliers.subtitle": "Тауардың негізгі жеткізушісі тауардың өз картасында таңдалады.",
  "suppliers.add": "Жеткізуші қосу",
  "suppliers.name": "Атауы",
  "suppliers.contact": "Байланыс тұлғасы",
  "suppliers.phone": "Телефон",
  "suppliers.note": "Ескертпе",
  "suppliers.save": "Сақтау",
  "suppliers.cancel": "Бас тарту",
  "suppliers.edit": "Өзгерту",
  "suppliers.remove": "Жою",
  "suppliers.removeConfirm":
    "«{name}» жеткізушісін жою керек пе? Онымен тауар саны: {n} — олардан алынады.",
  "suppliers.empty": "Жеткізушілер әзірше жоқ.",
  "suppliers.products": "тауар: {n}",
  "product.supplier.card": "Жеткізуші",
  "product.supplier.none": "Таңдалмаған",
  "product.supplier.hint": "Осы тауардың негізгі жеткізушісі. Тізім — «Қойма» бөлімінде.",
  "product.supplier.empty": "Жеткізушілер әлі жоқ — оларды «Қойма» бөлімінде қосыңыз.",
};

export const en: SectionDict<typeof ru> = {
  "warehouse.nav": "Warehouse",
  "warehouse.title": "Warehouse",
  "warehouse.subtitle":
    "Suppliers and stock movements. Every stock change stays in the product's history.",
  "warehouse.back": "← Warehouse",
  "warehouse.hub.suppliers": "Suppliers",
  "warehouse.hub.suppliersHint": "Who supplies what: contacts and each product's main supplier.",
  "suppliers.title": "Suppliers",
  "suppliers.subtitle": "A product's main supplier is chosen on the product's own page.",
  "suppliers.add": "Add supplier",
  "suppliers.name": "Name",
  "suppliers.contact": "Contact person",
  "suppliers.phone": "Phone",
  "suppliers.note": "Note",
  "suppliers.save": "Save",
  "suppliers.cancel": "Cancel",
  "suppliers.edit": "Edit",
  "suppliers.remove": "Delete",
  "suppliers.removeConfirm":
    "Delete supplier “{name}”? Products with this supplier: {n} — it will be removed from them.",
  "suppliers.empty": "No suppliers yet.",
  "suppliers.products": "products: {n}",
  "product.supplier.card": "Supplier",
  "product.supplier.none": "Not set",
  "product.supplier.hint": "This product's main supplier. The list is in the Warehouse section.",
  "product.supplier.empty": "No suppliers yet — add them in the Warehouse section.",
};

export const uz: SectionDict<typeof ru> = {
  "warehouse.nav": "Ombor",
  "warehouse.title": "Ombor",
  "warehouse.subtitle":
    "Yetkazib beruvchilar va qoldiq harakati. Qoldiqning har bir oʻzgarishi tovar tarixida saqlanadi.",
  "warehouse.back": "← Ombor",
  "warehouse.hub.suppliers": "Yetkazib beruvchilar",
  "warehouse.hub.suppliersHint":
    "Kim nima olib keladi: aloqa maʼlumotlari va har bir tovarning asosiy yetkazib beruvchisi.",
  "suppliers.title": "Yetkazib beruvchilar",
  "suppliers.subtitle": "Tovarning asosiy yetkazib beruvchisi tovarning oʻz sahifasida tanlanadi.",
  "suppliers.add": "Yetkazib beruvchi qoʻshish",
  "suppliers.name": "Nomi",
  "suppliers.contact": "Aloqa shaxsi",
  "suppliers.phone": "Telefon",
  "suppliers.note": "Izoh",
  "suppliers.save": "Saqlash",
  "suppliers.cancel": "Bekor qilish",
  "suppliers.edit": "Oʻzgartirish",
  "suppliers.remove": "Oʻchirish",
  "suppliers.removeConfirm":
    "«{name}» yetkazib beruvchisini oʻchirasizmi? U bilan tovarlar soni: {n} — ulardan olib tashlanadi.",
  "suppliers.empty": "Yetkazib beruvchilar hozircha yoʻq.",
  "suppliers.products": "tovarlar: {n}",
  "product.supplier.card": "Yetkazib beruvchi",
  "product.supplier.none": "Tanlanmagan",
  "product.supplier.hint": "Bu tovarning asosiy yetkazib beruvchisi. Roʻyxat — «Ombor» boʻlimida.",
  "product.supplier.empty": "Yetkazib beruvchilar hali yoʻq — ularni «Ombor» boʻlimida qoʻshing.",
};
