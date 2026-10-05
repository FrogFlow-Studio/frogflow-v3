import type { SectionDict } from "../section";

/** Путь Р партии 22: первая продажа продавца (импорт, шаблоны, чек-лист, пробный заказ, «Поделиться»). */
export const ru = {
  "products.import.intro22":
    "Загрузите таблицу CSV или Excel (.xlsx), первый лист. Колонки: Название (обязательно), Артикул, Цена, Категория, Описание, Остаток, Фото (ссылки https через пробел, до 5). Товар находится по артикулу, а если его нет — по названию, поэтому повторная загрузка ничего не задваивает.",
  "products.import.choose22": "Выбрать CSV или Excel",
  "products.import.withPhotos":
    "Товаров с фото по ссылкам: {n}. Фото скачиваются при применении, это дольше обычного.",
  "products.import.warningsTitle": "Взято не всё:",
  "products.import.photosDone": "Фото добавлено у товаров: {n}",
  "err.xlsx.bad": "Не похоже на файл Excel (.xlsx)",
  "err.xlsx.big": "Лист Excel слишком большой — сохраните его как CSV",
};

export const kk: SectionDict<typeof ru> = {
  "products.import.intro22":
    "CSV немесе Excel (.xlsx) кестесін жүктеңіз, бірінші парақ. Бағандар: Атауы (міндетті), Артикул, Баға, Санат, Сипаттама, Қалдық, Фото (https сілтемелері бос орынмен, 5-ке дейін). Тауар артикул бойынша, ол болмаса атауы бойынша табылады, сондықтан қайта жүктеу ештеңені екі еселемейді.",
  "products.import.choose22": "CSV немесе Excel таңдау",
  "products.import.withPhotos":
    "Сілтеме бойынша фотосы бар тауарлар: {n}. Фото қолданғанда жүктеледі, бұл әдеттегіден ұзағырақ.",
  "products.import.warningsTitle": "Бәрі алынбады:",
  "products.import.photosDone": "Фото қосылған тауарлар: {n}",
  "err.xlsx.bad": "Excel (.xlsx) файлына ұқсамайды",
  "err.xlsx.big": "Excel парағы тым үлкен — оны CSV ретінде сақтаңыз",
};

export const en: SectionDict<typeof ru> = {
  "products.import.intro22":
    "Upload a CSV or Excel (.xlsx) table, first sheet. Columns: Name (required), SKU, Price, Category, Description, Stock, Photos (https links separated by spaces, up to 5). A product is matched by SKU, or by name when there is none, so uploading again never creates duplicates.",
  "products.import.choose22": "Choose CSV or Excel",
  "products.import.withPhotos":
    "Products with photo links: {n}. Photos are downloaded when you apply, which takes longer than usual.",
  "products.import.warningsTitle": "Not everything was taken:",
  "products.import.photosDone": "Products with photos added: {n}",
  "err.xlsx.bad": "This doesn't look like an Excel (.xlsx) file",
  "err.xlsx.big": "The Excel sheet is too large — save it as CSV",
};

export const uz: SectionDict<typeof ru> = {
  "products.import.intro22":
    "CSV yoki Excel (.xlsx) jadvalini yuklang, birinchi varaq. Ustunlar: Nomi (majburiy), Artikul, Narx, Kategoriya, Tavsif, Qoldiq, Foto (https havolalari bo‘sh joy bilan, 5 tagacha). Mahsulot artikul bo‘yicha, u bo‘lmasa nomi bo‘yicha topiladi, shuning uchun qayta yuklash hech narsani ikkilantirmaydi.",
  "products.import.choose22": "CSV yoki Excel tanlash",
  "products.import.withPhotos":
    "Havola bo‘yicha fotosi bor mahsulotlar: {n}. Foto qo‘llashda yuklanadi, bu odatdagidan uzoqroq.",
  "products.import.warningsTitle": "Hammasi olinmadi:",
  "products.import.photosDone": "Foto qo‘shilgan mahsulotlar: {n}",
  "err.xlsx.bad": "Excel (.xlsx) fayliga o‘xshamaydi",
  "err.xlsx.big": "Excel varag‘i juda katta — uni CSV sifatida saqlang",
};
