import type { SectionDict } from "../section";

/** Список товаров: порядок, фильтр «Язык материалов», дата и языки у товара. */
export const ru = {
  "products.sort.label": "Порядок",
  "products.sort.catalog": "Как в каталоге",
  "products.sort.new": "Сначала новые",
  "products.sort.old": "Сначала старые",
  "products.sort.name": "По названию",
  "products.sort.price": "По цене",
  "products.lang.label": "Язык материалов",
  "products.lang.all": "Все языки",
  "products.lang.has": "Есть на {lang}",
  "products.lang.missing": "Нет на {lang}",
  "products.lang.missingHint":
    "«Нет на языке» показывает цифровые товары без файла на этом языке. Физические товары и курсы сюда не попадают.",
  "products.col.added": "Добавлен",
  "products.col.langs": "Языки",
  "products.reorderHint":
    "Порядок перетаскиванием меняется в режиме «Как в каталоге» без фильтров.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "products.sort.label": "Реті",
  "products.sort.catalog": "Каталогтағыдай",
  "products.sort.new": "Алдымен жаңалары",
  "products.sort.old": "Алдымен ескілері",
  "products.sort.name": "Атауы бойынша",
  "products.sort.price": "Бағасы бойынша",
  "products.lang.label": "Материалдар тілі",
  "products.lang.all": "Барлық тілдер",
  "products.lang.has": "{lang} тілінде бар",
  "products.lang.missing": "{lang} тілінде жоқ",
  "products.lang.missingHint":
    "«Тілде жоқ» осы тілде файлы жоқ цифрлық тауарларды көрсетеді. Физикалық тауарлар мен курстар мұнда кірмейді.",
  "products.col.added": "Қосылған",
  "products.col.langs": "Тілдер",
  "products.reorderHint":
    "Сүйреп ретін өзгерту «Каталогтағыдай» режимінде, сүзгісіз жұмыс істейді.",
};

export const en: SectionDict<typeof ru> = {
  "products.sort.label": "Order",
  "products.sort.catalog": "As in catalog",
  "products.sort.new": "Newest first",
  "products.sort.old": "Oldest first",
  "products.sort.name": "By name",
  "products.sort.price": "By price",
  "products.lang.label": "Material language",
  "products.lang.all": "All languages",
  "products.lang.has": "Has {lang}",
  "products.lang.missing": "No {lang}",
  "products.lang.missingHint":
    "“No language” shows digital products without a file in that language. Physical products and courses are not included.",
  "products.col.added": "Added",
  "products.col.langs": "Languages",
  "products.reorderHint": "Drag to reorder in “As in catalog” mode without filters.",
};

export const uz: SectionDict<typeof ru> = {
  "products.sort.label": "Tartib",
  "products.sort.catalog": "Katalogdagidek",
  "products.sort.new": "Avval yangilari",
  "products.sort.old": "Avval eskilari",
  "products.sort.name": "Nomi bo‘yicha",
  "products.sort.price": "Narxi bo‘yicha",
  "products.lang.label": "Materiallar tili",
  "products.lang.all": "Barcha tillar",
  "products.lang.has": "{lang} tilida bor",
  "products.lang.missing": "{lang} tilida yo‘q",
  "products.lang.missingHint":
    "«Tilda yo‘q» shu tilda fayli bo‘lmagan raqamli tovarlarni ko‘rsatadi. Jismoniy tovarlar va kurslar bu yerga kirmaydi.",
  "products.col.added": "Qo‘shilgan",
  "products.col.langs": "Tillar",
  "products.reorderHint": "Sudrab tartiblash «Katalogdagidek» rejimida, filtrlarsiz ishlaydi.",
};
