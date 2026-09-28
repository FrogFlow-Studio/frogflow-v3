import type { SectionDict } from "../section";

/** Раздел «Прайс консультанта» — консультант по прайсу BOVI (app/admin/pricelist.server). */
export const ru = {
  "pricelist.nav": "Прайс консультанта",
  "pricelist.title": "Прайс консультанта",
  "pricelist.subtitle":
    "Откуда консультант берёт позиции, цены, курс рубля и фото. Загрузите свежую выгрузку 1С — консультант начнёт отвечать по ней в течение минуты.",
  "pricelist.file.title": "Прайс из 1С",
  "pricelist.file.hint":
    "CSV-выгрузка из 1С: название, раздел, размер, цвет, цена, остаток. Позиции с пометкой «не для продажи» покупателям не показываются.",
  "pricelist.file.choose": "Загрузить CSV",
  "pricelist.file.meta": "{count} позиций · загружен {date} · {source}",
  "pricelist.file.hidden": "Скрыто от покупателей (снято с продажи): {count}",
  "pricelist.file.none": "Прайс ещё не загружен.",
  "pricelist.file.loaded": "Загружено позиций: {count}.",
  "pricelist.file.errors": "Строк с ошибками: {count}. Первые из них:",
  "pricelist.file.row": "строка {row}: {message}",
  "pricelist.settings.title": "Марки, сайт и бутик",
  "pricelist.settings.synonyms": "Синонимы марок",
  "pricelist.settings.synonymsHint":
    "Одна строка — одна марка: сначала как в прайсе, потом как спрашивают покупатели. Например: «pip, голландские, голландия».",
  "pricelist.settings.shopUrl": "Сайт магазина",
  "pricelist.settings.address": "Адрес бутика",
  "pricelist.settings.phone": "Телефон",
  "pricelist.settings.storeHours": "Часы работы бутика",
  "pricelist.settings.followUp": "Напоминать замолчавшему покупателю",
  "pricelist.settings.followUpHint":
    "Через 3 часа после ответа с товаром — одна строка «Остались вопросы по …?», не ночью и не после передачи менеджеру.",
  "pricelist.settings.digest": "Сводка качества ответов каждое утро",
  "pricelist.settings.digestHint":
    "После 9:00 — сколько ответов за вчера, сколько передано менеджеру, замечания к ценам и форме, расход.",
  "pricelist.save": "Сохранить",
  "pricelist.saved": "Сохранено.",
  "pricelist.hours":
    "Консультант считает нерабочим время с {close}:00 до {open}:00 — ночью он говорит, что менеджер ответит утром. Часы меняет оператор.",
  "pricelist.rate.title": "Курс рубля",
  "pricelist.rate.current": "{rate} ₸ за рубль",
  "pricelist.rate.updated": "Обновлён {date} · {source}",
  "pricelist.rate.stale":
    "Курс старше трёх дней — цены в рублях покупателям не называются, пока он не обновится.",
  "pricelist.rate.none": "Курса ещё нет — цены в рублях покупателям не называются.",
  "pricelist.rate.refresh": "Обновить сейчас",
  "pricelist.rate.manual": "Курс вручную",
  "pricelist.rate.manualHint": "Сколько тенге банк платит за рубль, например 4,79.",
  "pricelist.rate.setManual": "Сохранить курс",
  "pricelist.rate.failed": "Банк не ответил — оставлен прежний курс.",
  "pricelist.rate.lastAttempt": "Последняя попытка {date}:",
  "pricelist.media.title": "Фото и видео товаров",
  "pricelist.media.hint":
    "Фото привязывается к модели, а не к строке прайса: «Uchino Zero Twist» подойдёт всем размерам и переживёт новую выгрузку. Консультант пришлёт его покупателю, когда попросят.",
  "pricelist.media.match": "Модель, как в прайсе",
  "pricelist.media.color": "Цвет (если фото одного цвета)",
  "pricelist.media.file": "Фото или видео до 25 МБ",
  "pricelist.media.add": "Добавить",
  "pricelist.media.empty": "Фото пока нет — на просьбу о фото консультант зовёт менеджера.",
  "pricelist.media.video": "видео",
  "pricelist.delete": "Удалить",
  "pricelist.kb.title": "База знаний",
  "pricelist.kb.hint":
    "Статьи о марках, материалах, уходе и доставке. Консультант подкладывает нужную к вопросу покупателя и не придумывает сверх неё.",
  "pricelist.kb.articleTitle": "Заголовок",
  "pricelist.kb.content": "Текст статьи",
  "pricelist.kb.add": "Добавить статью",
  "pricelist.uploadFailed": "Файл не загрузился (код {status}).",
  "pricelist.usage.title": "Расход консультанта за 7 дней",
  "pricelist.usage.summary":
    "{messages} ответов · ${usd} · в среднем ${per} за ответ · из кеша {share}% ввода",
  "pricelist.usage.empty": "Ответов за неделю пока нет.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "pricelist.nav": "Кеңесші прайсы",
  "pricelist.title": "Кеңесші прайсы",
  "pricelist.subtitle":
    "Кеңесші позицияларды, бағаларды, рубль бағамын және фотоларды қайдан алады. 1С-тен жаңа түсірілімді жүктеңіз — кеңесші бір минут ішінде соған сүйеніп жауап береді.",
  "pricelist.file.title": "1С прайсы",
  "pricelist.file.hint":
    "1С-тен CSV түсірілімі: атауы, бөлімі, өлшемі, түсі, бағасы, қалдығы. «Сатылмайды» белгісі бар позициялар сатып алушыларға көрсетілмейді.",
  "pricelist.file.choose": "CSV жүктеу",
  "pricelist.file.meta": "{count} позиция · {date} жүктелді · {source}",
  "pricelist.file.hidden": "Сатып алушылардан жасырылған (сатылымнан алынған): {count}",
  "pricelist.file.none": "Прайс әлі жүктелмеген.",
  "pricelist.file.loaded": "Жүктелген позициялар: {count}.",
  "pricelist.file.errors": "Қатесі бар жолдар: {count}. Алғашқылары:",
  "pricelist.file.row": "{row}-жол: {message}",
  "pricelist.settings.title": "Маркалар, сайт және бутик",
  "pricelist.settings.synonyms": "Марка синонимдері",
  "pricelist.settings.synonymsHint":
    "Бір жол — бір марка: алдымен прайстағыдай, содан кейін сатып алушылар қалай сұрайды. Мысалы: «pip, голландские, голландия».",
  "pricelist.settings.shopUrl": "Дүкен сайты",
  "pricelist.settings.address": "Бутик мекенжайы",
  "pricelist.settings.phone": "Телефон",
  "pricelist.settings.storeHours": "Бутиктің жұмыс уақыты",
  "pricelist.settings.followUp": "Үнсіз қалған сатып алушыға еске салу",
  "pricelist.settings.followUpHint":
    "Тауармен жауаптан 3 сағат өткен соң — бір жол «… бойынша сұрақтар қалды ма?», түнде емес және менеджерге бергеннен кейін емес.",
  "pricelist.settings.digest": "Әр таң сайын жауап сапасының жиынтығы",
  "pricelist.settings.digestHint":
    "9:00-ден кейін — кешегі жауаптар саны, менеджерге берілгені, баға мен пішінге ескертулер, шығын.",
  "pricelist.save": "Сақтау",
  "pricelist.saved": "Сақталды.",
  "pricelist.hours":
    "Кеңесші {close}:00-ден {open}:00-ге дейін жұмыстан тыс уақыт деп санайды — түнде менеджер таңертең жауап береді дейді. Уақытты оператор өзгертеді.",
  "pricelist.rate.title": "Рубль бағамы",
  "pricelist.rate.current": "Бір рубль үшін {rate} ₸",
  "pricelist.rate.updated": "{date} жаңартылды · {source}",
  "pricelist.rate.stale":
    "Бағам үш күннен ескі — жаңартылмайынша сатып алушыларға рубльдегі баға айтылмайды.",
  "pricelist.rate.none": "Бағам әлі жоқ — сатып алушыларға рубльдегі баға айтылмайды.",
  "pricelist.rate.refresh": "Қазір жаңарту",
  "pricelist.rate.manual": "Бағамды қолмен енгізу",
  "pricelist.rate.manualHint": "Банк бір рубль үшін неше теңге төлейді, мысалы 4,79.",
  "pricelist.rate.setManual": "Бағамды сақтау",
  "pricelist.rate.failed": "Банк жауап бермеді — бұрынғы бағам қалды.",
  "pricelist.rate.lastAttempt": "Соңғы әрекет {date}:",
  "pricelist.media.title": "Тауар фотолары мен бейнелері",
  "pricelist.media.hint":
    "Фото прайс жолына емес, модельге байланады: «Uchino Zero Twist» барлық өлшемге сәйкес келеді және жаңа түсірілімнен кейін де сақталады. Сұраса, кеңесші оны сатып алушыға жібереді.",
  "pricelist.media.match": "Модель, прайстағыдай",
  "pricelist.media.color": "Түсі (фото бір түсті болса)",
  "pricelist.media.file": "25 МБ-қа дейінгі фото не бейне",
  "pricelist.media.add": "Қосу",
  "pricelist.media.empty": "Фото әлі жоқ — фото сұраса, кеңесші менеджерді шақырады.",
  "pricelist.media.video": "бейне",
  "pricelist.delete": "Өшіру",
  "pricelist.kb.title": "Білім базасы",
  "pricelist.kb.hint":
    "Маркалар, материалдар, күтім және жеткізу туралы мақалалар. Кеңесші сатып алушының сұрағына керегін қосады және одан тыс ойдан шығармайды.",
  "pricelist.kb.articleTitle": "Тақырып",
  "pricelist.kb.content": "Мақала мәтіні",
  "pricelist.kb.add": "Мақала қосу",
  "pricelist.uploadFailed": "Файл жүктелмеді (код {status}).",
  "pricelist.usage.title": "Кеңесшінің 7 күндегі шығыны",
  "pricelist.usage.summary":
    "{messages} жауап · ${usd} · бір жауапқа орта есеппен ${per} · енгізудің {share}%-ы кэштен",
  "pricelist.usage.empty": "Аптада әлі жауап жоқ.",
};

export const en: SectionDict<typeof ru> = {
  "pricelist.nav": "Consultant price list",
  "pricelist.title": "Consultant price list",
  "pricelist.subtitle":
    "Where the consultant gets items, prices, the ruble rate and photos. Upload a fresh 1C export — the consultant starts answering from it within a minute.",
  "pricelist.file.title": "Price list from 1C",
  "pricelist.file.hint":
    "CSV export from 1C: name, section, size, color, price, stock. Items marked “not for sale” are not shown to customers.",
  "pricelist.file.choose": "Upload CSV",
  "pricelist.file.meta": "{count} items · uploaded {date} · {source}",
  "pricelist.file.hidden": "Hidden from customers (discontinued): {count}",
  "pricelist.file.none": "No price list uploaded yet.",
  "pricelist.file.loaded": "Items uploaded: {count}.",
  "pricelist.file.errors": "Rows with errors: {count}. The first of them:",
  "pricelist.file.row": "row {row}: {message}",
  "pricelist.settings.title": "Brands, website and store",
  "pricelist.settings.synonyms": "Brand synonyms",
  "pricelist.settings.synonymsHint":
    "One line per brand: first as in the price list, then how customers ask for it. For example: “pip, dutch, holland”.",
  "pricelist.settings.shopUrl": "Shop website",
  "pricelist.settings.address": "Store address",
  "pricelist.settings.phone": "Phone",
  "pricelist.settings.storeHours": "Store opening hours",
  "pricelist.settings.followUp": "Follow up with customers who went quiet",
  "pricelist.settings.followUpHint":
    "Three hours after a reply about a product — one line “Any questions about …?”, not at night and not after a manager handoff.",
  "pricelist.settings.digest": "Reply quality summary every morning",
  "pricelist.settings.digestHint":
    "After 9:00 — yesterday's replies, handoffs to a manager, price and form remarks, spend.",
  "pricelist.save": "Save",
  "pricelist.saved": "Saved.",
  "pricelist.hours":
    "The consultant treats {close}:00 to {open}:00 as off-hours — at night it says a manager will reply in the morning. The operator changes the hours.",
  "pricelist.rate.title": "Ruble rate",
  "pricelist.rate.current": "{rate} ₸ per ruble",
  "pricelist.rate.updated": "Updated {date} · {source}",
  "pricelist.rate.stale":
    "The rate is older than three days — ruble prices are not quoted to customers until it updates.",
  "pricelist.rate.none": "No rate yet — ruble prices are not quoted to customers.",
  "pricelist.rate.refresh": "Refresh now",
  "pricelist.rate.manual": "Manual rate",
  "pricelist.rate.manualHint": "How many tenge the bank pays per ruble, e.g. 4.79.",
  "pricelist.rate.setManual": "Save rate",
  "pricelist.rate.failed": "The bank did not respond — the previous rate is kept.",
  "pricelist.rate.lastAttempt": "Last attempt {date}:",
  "pricelist.media.title": "Product photos and videos",
  "pricelist.media.hint":
    "A photo is tied to a model, not to a price-list row: “Uchino Zero Twist” fits every size and survives a new export. The consultant sends it to customers who ask.",
  "pricelist.media.match": "Model, as in the price list",
  "pricelist.media.color": "Color (if the photo shows one color)",
  "pricelist.media.file": "Photo or video up to 25 MB",
  "pricelist.media.add": "Add",
  "pricelist.media.empty":
    "No photos yet — when asked for a photo, the consultant calls a manager.",
  "pricelist.media.video": "video",
  "pricelist.delete": "Delete",
  "pricelist.kb.title": "Knowledge base",
  "pricelist.kb.hint":
    "Articles about brands, materials, care and delivery. The consultant attaches the right one to a customer's question and does not make up anything beyond it.",
  "pricelist.kb.articleTitle": "Title",
  "pricelist.kb.content": "Article text",
  "pricelist.kb.add": "Add article",
  "pricelist.uploadFailed": "The file did not upload (code {status}).",
  "pricelist.usage.title": "Consultant spend, last 7 days",
  "pricelist.usage.summary":
    "{messages} replies · ${usd} · ${per} per reply on average · {share}% of input from cache",
  "pricelist.usage.empty": "No replies this week yet.",
};

export const uz: SectionDict<typeof ru> = {
  "pricelist.nav": "Maslahatchi narxnomasi",
  "pricelist.title": "Maslahatchi narxnomasi",
  "pricelist.subtitle":
    "Maslahatchi pozitsiyalar, narxlar, rubl kursi va rasmlarni qayerdan oladi. 1C dan yangi eksportni yuklang — maslahatchi bir daqiqa ichida unga tayanib javob beradi.",
  "pricelist.file.title": "1C narxnomasi",
  "pricelist.file.hint":
    "1C dan CSV eksport: nomi, bo‘lim, o‘lcham, rang, narx, qoldiq. «Sotilmaydi» belgili pozitsiyalar xaridorlarga ko‘rsatilmaydi.",
  "pricelist.file.choose": "CSV yuklash",
  "pricelist.file.meta": "{count} pozitsiya · {date} yuklangan · {source}",
  "pricelist.file.hidden": "Xaridorlardan yashirilgan (sotuvdan olingan): {count}",
  "pricelist.file.none": "Narxnoma hali yuklanmagan.",
  "pricelist.file.loaded": "Yuklangan pozitsiyalar: {count}.",
  "pricelist.file.errors": "Xatoli qatorlar: {count}. Birinchilari:",
  "pricelist.file.row": "{row}-qator: {message}",
  "pricelist.settings.title": "Brendlar, sayt va butik",
  "pricelist.settings.synonyms": "Brend sinonimlari",
  "pricelist.settings.synonymsHint":
    "Bir qator — bir brend: avval narxnomadagidek, keyin xaridorlar qanday so‘rashi. Masalan: «pip, gollandcha, gollandiya».",
  "pricelist.settings.shopUrl": "Do‘kon sayti",
  "pricelist.settings.address": "Butik manzili",
  "pricelist.settings.phone": "Telefon",
  "pricelist.settings.storeHours": "Butik ish vaqti",
  "pricelist.settings.followUp": "Jim qolgan xaridorga eslatish",
  "pricelist.settings.followUpHint":
    "Mahsulot haqidagi javobdan 3 soat o‘tib — bitta qator «… bo‘yicha savollar qoldimi?», tunda emas va menejerga berilgandan keyin emas.",
  "pricelist.settings.digest": "Har tongda javoblar sifati xulosasi",
  "pricelist.settings.digestHint":
    "9:00 dan keyin — kechagi javoblar soni, menejerga berilganlari, narx va shakl bo‘yicha izohlar, xarajat.",
  "pricelist.save": "Saqlash",
  "pricelist.saved": "Saqlandi.",
  "pricelist.hours":
    "Maslahatchi {close}:00 dan {open}:00 gacha ishdan tashqari vaqt deb hisoblaydi — tunda menejer ertalab javob beradi, deydi. Vaqtni operator o‘zgartiradi.",
  "pricelist.rate.title": "Rubl kursi",
  "pricelist.rate.current": "Bir rubl uchun {rate} ₸",
  "pricelist.rate.updated": "{date} yangilangan · {source}",
  "pricelist.rate.stale":
    "Kurs uch kundan eski — yangilanmaguncha xaridorlarga rubldagi narx aytilmaydi.",
  "pricelist.rate.none": "Kurs hali yo‘q — xaridorlarga rubldagi narx aytilmaydi.",
  "pricelist.rate.refresh": "Hozir yangilash",
  "pricelist.rate.manual": "Kursni qo‘lda kiritish",
  "pricelist.rate.manualHint": "Bank bir rubl uchun necha tenge to‘laydi, masalan 4,79.",
  "pricelist.rate.setManual": "Kursni saqlash",
  "pricelist.rate.failed": "Bank javob bermadi — avvalgi kurs qoldi.",
  "pricelist.rate.lastAttempt": "Oxirgi urinish {date}:",
  "pricelist.media.title": "Mahsulot rasmlari va videolari",
  "pricelist.media.hint":
    "Rasm narxnoma qatoriga emas, modelga bog‘lanadi: «Uchino Zero Twist» barcha o‘lchamlarga mos keladi va yangi eksportdan keyin ham saqlanadi. So‘rashsa, maslahatchi uni xaridorga yuboradi.",
  "pricelist.media.match": "Model, narxnomadagidek",
  "pricelist.media.color": "Rang (rasm bir rangda bo‘lsa)",
  "pricelist.media.file": "25 MB gacha rasm yoki video",
  "pricelist.media.add": "Qo‘shish",
  "pricelist.media.empty": "Rasmlar hali yo‘q — rasm so‘ralsa, maslahatchi menejerni chaqiradi.",
  "pricelist.media.video": "video",
  "pricelist.delete": "O‘chirish",
  "pricelist.kb.title": "Bilimlar bazasi",
  "pricelist.kb.hint":
    "Brendlar, materiallar, parvarish va yetkazib berish haqida maqolalar. Maslahatchi xaridor savoliga keraklisini qo‘shadi va undan ortiq narsa to‘qimaydi.",
  "pricelist.kb.articleTitle": "Sarlavha",
  "pricelist.kb.content": "Maqola matni",
  "pricelist.kb.add": "Maqola qo‘shish",
  "pricelist.uploadFailed": "Fayl yuklanmadi (kod {status}).",
  "pricelist.usage.title": "Maslahatchining 7 kunlik xarajati",
  "pricelist.usage.summary":
    "{messages} javob · ${usd} · bir javobga o‘rtacha ${per} · kirishning {share}% keshdan",
  "pricelist.usage.empty": "Haftada hali javoblar yo‘q.",
};
