import type { SectionDict } from "../section";

/** Каталог из Google Таблицы в разделе «Товары» (core/catalog/sheet). */
export const ru = {
  "sheet.title": "Каталог из Google Таблицы",
  "sheet.intro":
    "Ведите товары в Google Таблице: вставьте ссылку, и каталог будет обновляться из неё каждую ночь. Колонки те же, что у импорта CSV. Откройте таблице доступ «Все, у кого есть ссылка» (читатель); ключ Google не нужен.",
  "sheet.url": "Ссылка на таблицу",
  "sheet.check": "Проверить",
  "sheet.checking": "Проверяю…",
  "sheet.hideMissing":
    "Скрывать товары, которых больше нет в таблице (не удаляются, их можно показать снова)",
  "sheet.overwriteManual": "Таблица главнее: перезаписывать то, что я поправил в админке",
  "sheet.manualNote":
    "Без второй галочки поля, которые вы поправили в админке, ночное обновление не трогает. Фото товаров таблица не меняет никогда, а товары не удаляет.",
  "sheet.connect": "Загрузить и обновлять каждую ночь",
  "sheet.save": "Сохранить настройки",
  "sheet.syncNow": "Обновить сейчас",
  "sheet.disconnect": "Отключить",
  "sheet.disconnectConfirm": "Отключить таблицу? Товары останутся как есть.",
  "sheet.confirm": "Создать {create} и обновить {update} товаров из таблицы?",
  "sheet.connected": "Подключена таблица:",
  "sheet.lastOk": "Обновлено {when}: создано {created}, обновлено {updated}, скрыто {hidden}.",
  "sheet.lastFail": "Не обновлено {when}: {reason}. Товары не тронуты.",
  "sheet.kept": "Оставлены ваши правки из админки: {n}.",
  "sheet.needsReview":
    "Строк совпало с товарами, добавленными вручную: {n}. Ночью их не трогаю; чтобы связать, нажмите «Обновить сейчас».",
  "sheet.skippedDeleted":
    "Товары, которые вы удалили, заново не создаю: {n}. Вернуть их — «Обновить сейчас».",
  "sheet.guard": "Из таблицы пропало больше половины товаров, поэтому скрывать их не стал.",
  "sheet.reason.badLink": "ссылка не похожа на Google Таблицу",
  "sheet.reason.closed": "таблица закрыта, откройте доступ «Все, у кого есть ссылка»",
  "sheet.reason.notFound": "таблица не найдена",
  "sheet.reason.download": "Google не отдал таблицу",
  "sheet.reason.notCsv": "вместо таблицы пришло что-то другое",
  "sheet.reason.tooBig": "таблица больше 4 МБ",
  "sheet.reason.empty": "таблица пустая",
  "sheet.reason.noHeader": "в первой строке нет колонки «Название»",
} as const;

export const kk: SectionDict<typeof ru> = {
  "sheet.title": "Google Кестеден каталог",
  "sheet.intro":
    "Тауарларды Google Кестеде жүргізіңіз: сілтемені қойыңыз, каталог одан әр түні жаңарады. Бағандар CSV импорттағыдай. Кестеге «Сілтемесі бар барлығы» (оқырман) рұқсатын ашыңыз; Google кілті керек емес.",
  "sheet.url": "Кестеге сілтеме",
  "sheet.check": "Тексеру",
  "sheet.checking": "Тексерудемін…",
  "sheet.hideMissing": "Кестеде жоқ тауарларды жасыру (жойылмайды, қайта көрсетуге болады)",
  "sheet.overwriteManual": "Кесте басым: админкада түзеткенімді қайта жазу",
  "sheet.manualNote":
    "Екінші белгісіз админкада түзеткен өрістеріңізді түнгі жаңарту қозғамайды. Кесте тауар суреттерін ешқашан өзгертпейді және тауарларды жоймайды.",
  "sheet.connect": "Жүктеу және әр түні жаңарту",
  "sheet.save": "Баптауды сақтау",
  "sheet.syncNow": "Қазір жаңарту",
  "sheet.disconnect": "Ажырату",
  "sheet.disconnectConfirm": "Кестені ажырату керек пе? Тауарлар сол күйінде қалады.",
  "sheet.confirm": "Кестеден {create} тауар құрып, {update} тауарды жаңарту керек пе?",
  "sheet.connected": "Қосылған кесте:",
  "sheet.lastOk": "{when} жаңартылды: құрылды {created}, жаңартылды {updated}, жасырылды {hidden}.",
  "sheet.lastFail": "{when} жаңартылмады: {reason}. Тауарлар қозғалмады.",
  "sheet.kept": "Админкадағы түзетулеріңіз қалдырылды: {n}.",
  "sheet.needsReview":
    "Қолмен қосылған тауарлармен сәйкес келген жолдар: {n}. Түнде оларды қозғамаймын; байланыстыру үшін «Қазір жаңарту» басыңыз.",
  "sheet.skippedDeleted":
    "Сіз жойған тауарларды қайта құрмаймын: {n}. Қайтару үшін — «Қазір жаңарту».",
  "sheet.guard": "Кестеден тауарлардың жартысынан көбі жоғалды, сондықтан оларды жасырмадым.",
  "sheet.reason.badLink": "сілтеме Google Кестеге ұқсамайды",
  "sheet.reason.closed": "кесте жабық, «Сілтемесі бар барлығы» рұқсатын ашыңыз",
  "sheet.reason.notFound": "кесте табылмады",
  "sheet.reason.download": "Google кестені бермеді",
  "sheet.reason.notCsv": "кестенің орнына басқа нәрсе келді",
  "sheet.reason.tooBig": "кесте 4 МБ-тан үлкен",
  "sheet.reason.empty": "кесте бос",
  "sheet.reason.noHeader": "бірінші жолда «Атауы» бағаны жоқ",
};

export const en: SectionDict<typeof ru> = {
  "sheet.title": "Catalogue from Google Sheets",
  "sheet.intro":
    "Keep your products in a Google Sheet: paste the link and the catalogue will update from it every night. Columns are the same as for CSV import. Share the sheet as “Anyone with the link” (viewer); no Google key is needed.",
  "sheet.url": "Sheet link",
  "sheet.check": "Check",
  "sheet.checking": "Checking…",
  "sheet.hideMissing":
    "Hide products that are no longer in the sheet (they are not deleted and can be shown again)",
  "sheet.overwriteManual": "The sheet wins: overwrite what I edited in the admin panel",
  "sheet.manualNote":
    "Without the second box, the nightly update leaves fields you edited in the admin panel alone. The sheet never changes product photos and never deletes products.",
  "sheet.connect": "Load and update every night",
  "sheet.save": "Save settings",
  "sheet.syncNow": "Update now",
  "sheet.disconnect": "Disconnect",
  "sheet.disconnectConfirm": "Disconnect the sheet? Products stay as they are.",
  "sheet.confirm": "Create {create} and update {update} products from the sheet?",
  "sheet.connected": "Connected sheet:",
  "sheet.lastOk": "Updated {when}: {created} created, {updated} updated, {hidden} hidden.",
  "sheet.lastFail": "Not updated {when}: {reason}. Products were not touched.",
  "sheet.kept": "Your admin panel edits kept: {n}.",
  "sheet.needsReview":
    "Rows matching products you added by hand: {n}. They are left alone at night; press “Update now” to link them.",
  "sheet.skippedDeleted":
    "Products you deleted are not recreated: {n}. To bring them back, press “Update now”.",
  "sheet.guard": "More than half of the products disappeared from the sheet, so none were hidden.",
  "sheet.reason.badLink": "the link does not look like a Google Sheet",
  "sheet.reason.closed": "the sheet is private, share it as “Anyone with the link”",
  "sheet.reason.notFound": "the sheet was not found",
  "sheet.reason.download": "Google did not return the sheet",
  "sheet.reason.notCsv": "something other than a sheet came back",
  "sheet.reason.tooBig": "the sheet is larger than 4 MB",
  "sheet.reason.empty": "the sheet is empty",
  "sheet.reason.noHeader": "the first row has no “Name” column",
};

export const uz: SectionDict<typeof ru> = {
  "sheet.title": "Google Jadvaldan katalog",
  "sheet.intro":
    "Mahsulotlarni Google Jadvalda yuriting: havolani qo‘ying, katalog undan har kecha yangilanadi. Ustunlar CSV importidagidek. Jadvalga «Havolasi bor hamma» (o‘quvchi) ruxsatini bering; Google kaliti kerak emas.",
  "sheet.url": "Jadval havolasi",
  "sheet.check": "Tekshirish",
  "sheet.checking": "Tekshirilmoqda…",
  "sheet.hideMissing":
    "Jadvalda endi yo‘q mahsulotlarni yashirish (o‘chirilmaydi, qayta ko‘rsatish mumkin)",
  "sheet.overwriteManual": "Jadval ustun: admin panelda tuzatganlarimni qayta yozish",
  "sheet.manualNote":
    "Ikkinchi belgisiz admin panelda tuzatgan maydonlaringizga tungi yangilanish tegmaydi. Jadval mahsulot rasmlarini hech qachon o‘zgartirmaydi va mahsulotlarni o‘chirmaydi.",
  "sheet.connect": "Yuklash va har kecha yangilash",
  "sheet.save": "Sozlamalarni saqlash",
  "sheet.syncNow": "Hozir yangilash",
  "sheet.disconnect": "Uzish",
  "sheet.disconnectConfirm": "Jadval uzilsinmi? Mahsulotlar o‘z holicha qoladi.",
  "sheet.confirm": "Jadvaldan {create} ta mahsulot yaratilsin va {update} tasi yangilansinmi?",
  "sheet.connected": "Ulangan jadval:",
  "sheet.lastOk":
    "{when} yangilandi: yaratildi {created}, yangilandi {updated}, yashirildi {hidden}.",
  "sheet.lastFail": "{when} yangilanmadi: {reason}. Mahsulotlarga tegilmadi.",
  "sheet.kept": "Admin paneldagi tuzatishlaringiz qoldirildi: {n}.",
  "sheet.needsReview":
    "Qo‘lda qo‘shilgan mahsulotlarga mos kelgan qatorlar: {n}. Kechasi ularga tegmayman; bog‘lash uchun «Hozir yangilash»ni bosing.",
  "sheet.skippedDeleted":
    "Siz o‘chirgan mahsulotlarni qayta yaratmayman: {n}. Qaytarish uchun — «Hozir yangilash».",
  "sheet.guard":
    "Jadvaldan mahsulotlarning yarmidan ko‘pi yo‘qoldi, shuning uchun ular yashirilmadi.",
  "sheet.reason.badLink": "havola Google Jadvalga o‘xshamaydi",
  "sheet.reason.closed": "jadval yopiq, «Havolasi bor hamma» ruxsatini bering",
  "sheet.reason.notFound": "jadval topilmadi",
  "sheet.reason.download": "Google jadvalni bermadi",
  "sheet.reason.notCsv": "jadval o‘rniga boshqa narsa keldi",
  "sheet.reason.tooBig": "jadval 4 MB dan katta",
  "sheet.reason.empty": "jadval bo‘sh",
  "sheet.reason.noHeader": "birinchi qatorda «Nomi» ustuni yo‘q",
};
