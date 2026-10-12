import type { SectionDict } from "../section";

/** Раздел «Тексты бота»: приветствие, «вне часов работы», «спасибо за заказ», «не понял». */
export const ru = {
  "botTexts.nav": "Тексты бота",
  "botTexts.title": "Тексты бота",
  "botTexts.subtitle":
    "Что бот говорит сам. Оставьте поле пустым, и бот скажет стандартный текст. Предпросмотр показывает, как сообщение выглядит у покупателя.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "В WhatsApp эти тексты пока не подключены: там бот говорит стандартными словами.",
  "botTexts.key.welcome": "Приветствие",
  "botTexts.key.welcome.hint": "Покупатель нажимает «Старт» и выбирает язык.",
  "botTexts.key.off_hours": "Вне часов работы",
  "botTexts.key.off_hours.hint":
    "Когда покупатель пишет вне рабочих часов (их задаёте ниже), не чаще раза в 6 часов.",
  "botTexts.key.order_thanks": "Спасибо за заказ",
  "botTexts.key.order_thanks.hint":
    "Отдельное сообщение после оформления заказа. Пока своего текста нет, не отправляется.",
  "botTexts.key.not_understood": "Не понял",
  "botTexts.key.not_understood.hint": "Покупатель написал то, что бот не разобрал.",
  "botTexts.key.country_ask": "Вопрос о стране оплаты",
  "botTexts.key.country_ask.hint":
    "Над списком стран при оформлении заказа. Список и суммы бот добавит сам.",
  "botTexts.key.language_ask": "Вопрос о языке материалов",
  "botTexts.key.language_ask.hint": "Над списком языков, если у товара файлы на нескольких языках.",
  "botTexts.key.pay_after": "После оплаты",
  "botTexts.key.pay_after.hint":
    "Последняя строка сообщения с заказом, суммой и реквизитами (товары без доставки). Здесь обычно просят прислать чек.",
  "botTexts.key.receipt_how_to": "Как прислать чек",
  "botTexts.key.receipt_how_to.hint": "Ответ, когда покупатель спрашивает, как отправить чек.",
  "botTexts.key.receipt_received": "Чек получен",
  "botTexts.key.receipt_received.hint": "После фото чека, когда почта не нужна или не задана.",
  "botTexts.key.receipt_received_email": "Чек получен, почта есть",
  "botTexts.key.receipt_received_email.hint":
    "После фото чека, если почта покупателя уже записана.",
  "botTexts.key.receipt_need_email": "Чек получен, нужна почта",
  "botTexts.key.receipt_need_email.hint":
    "После фото чека, если материалы идут на почту, а её ещё нет.",
  "botTexts.key.receipt_manual": "Чек на ручной проверке",
  "botTexts.key.receipt_manual.hint":
    "Автоматическая проверка чека не прошла, заказ ушёл вам на подтверждение.",
  "botTexts.key.receipt_verified": "Чек проверен",
  "botTexts.key.receipt_verified.hint": "Чек прошёл проверку, следом бот отправляет файлы.",
  "botTexts.key.email_ask": "Вопрос о почте",
  "botTexts.key.email_ask.hint": "Когда бот спрашивает почту для материалов.",
  "botTexts.key.email_retry": "Это не почта",
  "botTexts.key.email_retry.hint": "Ответ на вопрос о почте не похож на адрес.",
  "botTexts.key.thanks_reply": "Ответ на «спасибо»",
  "botTexts.key.thanks_reply.hint":
    "Покупатель поблагодарил после выдачи заказа. Бот отвечает один раз на заказ, обращение не открывается.",
  "botTexts.key.foreign_pay_reply": "Оплата из другой страны",
  "botTexts.key.foreign_pay_reply.hint":
    "Покупатель спрашивает, как оплатить из страны, для которой у магазина нет способа оплаты (например, Беларусь, Узбекистан, Кыргызстан). Бот отвечает один раз в сутки, вопрос уходит вам обращением.",
  "botTexts.vars": "Можно вставить: {vars}",
  "botTexts.var.shop": "{shop} — название магазина",
  "botTexts.var.order": "{order} — номер заказа",
  "botTexts.var.from": "{from} — начало работы",
  "botTexts.var.to": "{to} — конец работы",
  "botTexts.var.email": "{email} — почта покупателя",
  "botTexts.unknownVar": "Нет такой подстановки: {name}. Она останется в тексте как есть.",
  "botTexts.custom": "Свой текст",
  "botTexts.standard": "Стандартный",
  "botTexts.preview": "Так увидит покупатель",
  "botTexts.save": "Сохранить",
  "botTexts.reset": "Вернуть стандартный",
  "botTexts.saved": "Сохранено",
  "botTexts.noCustom": "Стандартный текст",
  "botTexts.hours.title": "Рабочие часы",
  "botTexts.hours.hint":
    "По часовому поясу магазина. Вне этих часов бот отправляет текст «Вне часов работы». Без часов он не отправляется.",
  "botTexts.hours.open": "Начало",
  "botTexts.hours.close": "Конец",
  "botTexts.hours.none": "Не задано",
  "botTexts.hours.save": "Сохранить часы",
  "botTexts.hours.clear": "Убрать часы",
  "botTexts.notWiredConsultant":
    "Здесь только тексты Telegram-бота. В Instagram и WhatsApp покупателям отвечает ИИ-консультант своими словами: как он говорит, задаётся на странице консультанта.",
  "botTexts.openConsultant": "Открыть настройки консультанта",
  "botTexts.hours.hintTelegramOnly":
    "Только для Telegram-бота, по часовому поясу магазина: вне этих часов он отправляет «Вне часов работы» (не чаще раза в 6 часов). В Instagram и WhatsApp эти часы не действуют.",
  "botTexts.hours.hintPricelist":
    "Рабочие часы консультанта (вне них он говорит, что менеджер ответит утром) и часы бутика, которые он называет покупателям, — отдельные настройки на странице «{page}».",
} as const;

export const kk: SectionDict<typeof ru> = {
  "botTexts.nav": "Бот мәтіндері",
  "botTexts.title": "Бот мәтіндері",
  "botTexts.subtitle":
    "Бот өзі айтатын сөздер. Өрісті бос қалдырсаңыз, бот стандартты мәтінді айтады. Алдын ала қарау хабарлама сатып алушыда қалай көрінетінін көрсетеді.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "WhatsApp-та бұл мәтіндер әзірге қосылмаған: онда бот стандартты сөздермен жауап береді.",
  "botTexts.key.welcome": "Сәлемдесу",
  "botTexts.key.welcome.hint": "Сатып алушы «Бастау» батырмасын басып, тілді таңдайды.",
  "botTexts.key.off_hours": "Жұмыс уақытынан тыс",
  "botTexts.key.off_hours.hint":
    "Сатып алушы жұмыс уақытынан тыс жазғанда (уақытты төменде белгілейсіз), 6 сағатта бір реттен жиі емес.",
  "botTexts.key.order_thanks": "Тапсырыс үшін рахмет",
  "botTexts.key.order_thanks.hint":
    "Тапсырыс рәсімделген соң жеке хабарлама. Өз мәтініңіз болмайынша жіберілмейді.",
  "botTexts.key.not_understood": "Түсінбедім",
  "botTexts.key.not_understood.hint": "Сатып алушы бот түсінбеген мәтін жазды.",
  "botTexts.key.country_ask": "Төлем елі туралы сұрақ",
  "botTexts.key.country_ask.hint":
    "Тапсырыс рәсімдегенде елдер тізімінің үстінде. Тізім мен сомаларды бот өзі қосады.",
  "botTexts.key.language_ask": "Материалдар тілі туралы сұрақ",
  "botTexts.key.language_ask.hint": "Тауар файлдары бірнеше тілде болса, тілдер тізімінің үстінде.",
  "botTexts.key.pay_after": "Төлемнен кейін",
  "botTexts.key.pay_after.hint":
    "Тапсырыс, сома және деректемелер хабарламасының соңғы жолы (жеткізусіз тауарлар). Әдетте мұнда чек жіберуді сұрайды.",
  "botTexts.key.receipt_how_to": "Чекті қалай жіберу",
  "botTexts.key.receipt_how_to.hint": "Сатып алушы чекті қалай жіберуді сұрағанда берілетін жауап.",
  "botTexts.key.receipt_received": "Чек алынды",
  "botTexts.key.receipt_received.hint":
    "Чек суретінен кейін, пошта керек болмаса немесе берілмесе.",
  "botTexts.key.receipt_received_email": "Чек алынды, пошта бар",
  "botTexts.key.receipt_received_email.hint":
    "Чек суретінен кейін, сатып алушының поштасы жазылған болса.",
  "botTexts.key.receipt_need_email": "Чек алынды, пошта керек",
  "botTexts.key.receipt_need_email.hint":
    "Чек суретінен кейін, материалдар поштаға баратын болса, ал пошта әлі жоқ болса.",
  "botTexts.key.receipt_manual": "Чек қолмен тексерісте",
  "botTexts.key.receipt_manual.hint":
    "Чекті автоматты тексеру өтпеді, тапсырыс сізге растауға жіберілді.",
  "botTexts.key.receipt_verified": "Чек тексерілді",
  "botTexts.key.receipt_verified.hint": "Чек тексерістен өтті, бот артынша файлдарды жібереді.",
  "botTexts.key.email_ask": "Пошта туралы сұрақ",
  "botTexts.key.email_ask.hint": "Бот материалдар үшін поштаны сұрағанда.",
  "botTexts.key.email_retry": "Бұл пошта емес",
  "botTexts.key.email_retry.hint": "Пошта туралы сұраққа жауап мекенжайға ұқсамайды.",
  "botTexts.key.thanks_reply": "«Рақмет» сөзіне жауап",
  "botTexts.key.thanks_reply.hint":
    "Сатып алушы тапсырыс берілгеннен кейін алғыс айтты. Бот бір тапсырысқа бір рет жауап береді, өтініш ашылмайды.",
  "botTexts.key.foreign_pay_reply": "Басқа елден төлеу",
  "botTexts.key.foreign_pay_reply.hint":
    "Сатып алушы дүкенде төлем тәсілі жоқ елден (мысалы, Беларусь, Өзбекстан, Қырғызстан) қалай төлеуге болатынын сұрайды. Бот тәулігіне бір рет жауап береді, сұрақ сізге өтініш болып келеді.",
  "botTexts.vars": "Қоюға болады: {vars}",
  "botTexts.var.shop": "{shop} — дүкен атауы",
  "botTexts.var.order": "{order} — тапсырыс нөмірі",
  "botTexts.var.from": "{from} — жұмыс басталуы",
  "botTexts.var.to": "{to} — жұмыс аяқталуы",
  "botTexts.var.email": "{email} — сатып алушының поштасы",
  "botTexts.unknownVar": "Мұндай ауыстыру жоқ: {name}. Ол мәтінде өзгеріссіз қалады.",
  "botTexts.custom": "Өз мәтіні",
  "botTexts.standard": "Стандартты",
  "botTexts.preview": "Сатып алушы былай көреді",
  "botTexts.save": "Сақтау",
  "botTexts.reset": "Стандарттыны қайтару",
  "botTexts.saved": "Сақталды",
  "botTexts.noCustom": "Стандартты мәтін",
  "botTexts.hours.title": "Жұмыс уақыты",
  "botTexts.hours.hint":
    "Дүкеннің уақыт белдеуі бойынша. Осы сағаттардан тыс бот «Жұмыс уақытынан тыс» мәтінін жібереді. Сағат белгіленбесе, жіберілмейді.",
  "botTexts.hours.open": "Басы",
  "botTexts.hours.close": "Соңы",
  "botTexts.hours.none": "Белгіленбеген",
  "botTexts.hours.save": "Сағаттарды сақтау",
  "botTexts.hours.clear": "Сағаттарды алып тастау",
  "botTexts.notWiredConsultant":
    "Мұнда тек Telegram-боттың мәтіндері. Instagram мен WhatsApp-та сатып алушыларға ЖИ-кеңесші өз сөзімен жауап береді: оның қалай сөйлейтіні кеңесші бетінде бапталады.",
  "botTexts.openConsultant": "Кеңесші баптауларын ашу",
  "botTexts.hours.hintTelegramOnly":
    "Тек Telegram-бот үшін, дүкеннің уақыт белдеуі бойынша: осы сағаттардан тыс ол «Жұмыс уақытынан тыс» мәтінін жібереді (6 сағатта бір реттен жиі емес). Instagram мен WhatsApp-та бұл сағаттар әсер етпейді.",
  "botTexts.hours.hintPricelist":
    "Кеңесшінің жұмыс уақыты (одан тыс ол менеджер таңертең жауап береді дейді) және ол сатып алушыларға айтатын бутиктің жұмыс уақыты — «{page}» бетіндегі бөлек баптаулар.",
};

export const en: SectionDict<typeof ru> = {
  "botTexts.nav": "Bot texts",
  "botTexts.title": "Bot texts",
  "botTexts.subtitle":
    "What the bot says on its own. Leave a field empty and the bot uses the standard text. The preview shows how the message looks to the buyer.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "In WhatsApp these texts are not connected yet: the bot uses the standard wording there.",
  "botTexts.key.welcome": "Greeting",
  "botTexts.key.welcome.hint": "The buyer taps Start and picks a language.",
  "botTexts.key.off_hours": "Outside working hours",
  "botTexts.key.off_hours.hint":
    "When a buyer writes outside working hours (set below), at most once every 6 hours.",
  "botTexts.key.order_thanks": "Thank you for the order",
  "botTexts.key.order_thanks.hint":
    "A separate message after checkout. It is not sent until you write your own text.",
  "botTexts.key.not_understood": "Did not understand",
  "botTexts.key.not_understood.hint": "The buyer wrote something the bot could not parse.",
  "botTexts.key.country_ask": "Payment country question",
  "botTexts.key.country_ask.hint":
    "Above the list of countries at checkout. The bot adds the list and amounts itself.",
  "botTexts.key.language_ask": "Materials language question",
  "botTexts.key.language_ask.hint":
    "Above the list of languages when a product has files in several languages.",
  "botTexts.key.pay_after": "After payment",
  "botTexts.key.pay_after.hint":
    "The last line of the message with the order, amount and payment details (products without delivery). This is usually where you ask for the receipt.",
  "botTexts.key.receipt_how_to": "How to send a receipt",
  "botTexts.key.receipt_how_to.hint": "The reply when a buyer asks how to send the receipt.",
  "botTexts.key.receipt_received": "Receipt received",
  "botTexts.key.receipt_received.hint": "After a receipt photo, when no email is needed or set.",
  "botTexts.key.receipt_received_email": "Receipt received, email known",
  "botTexts.key.receipt_received_email.hint":
    "After a receipt photo, when the buyer’s email is already saved.",
  "botTexts.key.receipt_need_email": "Receipt received, email needed",
  "botTexts.key.receipt_need_email.hint":
    "After a receipt photo, when materials go by email and there is no email yet.",
  "botTexts.key.receipt_manual": "Receipt under manual review",
  "botTexts.key.receipt_manual.hint":
    "The automatic receipt check failed and the order was sent to you to confirm.",
  "botTexts.key.receipt_verified": "Receipt verified",
  "botTexts.key.receipt_verified.hint":
    "The receipt passed the check; the bot sends the files right after.",
  "botTexts.key.email_ask": "Email question",
  "botTexts.key.email_ask.hint": "When the bot asks for an email for the materials.",
  "botTexts.key.email_retry": "Not an email",
  "botTexts.key.email_retry.hint":
    "The answer to the email question does not look like an address.",
  "botTexts.key.thanks_reply": "Reply to “thank you”",
  "botTexts.key.thanks_reply.hint":
    "The buyer said thanks after the order was delivered. The bot replies once per order and opens no ticket.",
  "botTexts.key.foreign_pay_reply": "Payment from another country",
  "botTexts.key.foreign_pay_reply.hint":
    "The buyer asks how to pay from a country the shop has no payment method for (for example, Belarus, Uzbekistan, Kyrgyzstan). The bot replies once a day and the question comes to you as a ticket.",
  "botTexts.vars": "You can insert: {vars}",
  "botTexts.var.shop": "{shop} — shop name",
  "botTexts.var.order": "{order} — order number",
  "botTexts.var.from": "{from} — opening time",
  "botTexts.var.to": "{to} — closing time",
  "botTexts.var.email": "{email} — buyer’s email",
  "botTexts.unknownVar": "No such placeholder: {name}. It will stay in the text as is.",
  "botTexts.custom": "Your text",
  "botTexts.standard": "Standard",
  "botTexts.preview": "What the buyer sees",
  "botTexts.save": "Save",
  "botTexts.reset": "Back to standard",
  "botTexts.saved": "Saved",
  "botTexts.noCustom": "Standard text",
  "botTexts.hours.title": "Working hours",
  "botTexts.hours.hint":
    "In the shop's time zone. Outside these hours the bot sends the “Outside working hours” text. Without hours it is not sent.",
  "botTexts.hours.open": "From",
  "botTexts.hours.close": "To",
  "botTexts.hours.none": "Not set",
  "botTexts.hours.save": "Save hours",
  "botTexts.hours.clear": "Remove hours",
  "botTexts.notWiredConsultant":
    "Only the Telegram bot texts are here. In Instagram and WhatsApp the AI consultant answers buyers in its own words: how it speaks is set on the consultant page.",
  "botTexts.openConsultant": "Open consultant settings",
  "botTexts.hours.hintTelegramOnly":
    "Telegram bot only, in the shop time zone: outside these hours it sends “Outside working hours” (at most once every 6 hours). These hours do not apply in Instagram and WhatsApp.",
  "botTexts.hours.hintPricelist":
    "The consultant's working hours (outside them it says a manager will reply in the morning) and the boutique hours it tells buyers are separate settings on the “{page}” page.",
};

export const uz: SectionDict<typeof ru> = {
  "botTexts.nav": "Bot matnlari",
  "botTexts.title": "Bot matnlari",
  "botTexts.subtitle":
    "Bot oʻzi aytadigan soʻzlar. Maydonni boʻsh qoldirsangiz, bot standart matnni aytadi. Oldindan koʻrish xabar xaridorda qanday koʻrinishini koʻrsatadi.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "WhatsApp uchun bu matnlar hozircha ulanmagan: u yerda bot standart soʻzlar bilan javob beradi.",
  "botTexts.key.welcome": "Salomlashish",
  "botTexts.key.welcome.hint": "Xaridor «Start» tugmasini bosib, tilni tanlaydi.",
  "botTexts.key.off_hours": "Ish vaqtidan tashqari",
  "botTexts.key.off_hours.hint":
    "Xaridor ish vaqtidan tashqari yozganda (vaqtni pastda belgilaysiz), 6 soatda bir martadan koʻp emas.",
  "botTexts.key.order_thanks": "Buyurtma uchun rahmat",
  "botTexts.key.order_thanks.hint":
    "Buyurtma rasmiylashtirilgach alohida xabar. Oʻz matningiz boʻlmaguncha yuborilmaydi.",
  "botTexts.key.not_understood": "Tushunmadim",
  "botTexts.key.not_understood.hint": "Xaridor bot tushunmagan narsa yozdi.",
  "botTexts.key.country_ask": "Toʻlov mamlakati haqida savol",
  "botTexts.key.country_ask.hint":
    "Buyurtma rasmiylashtirilganda mamlakatlar roʻyxati ustida. Roʻyxat va summalarni bot oʻzi qoʻshadi.",
  "botTexts.key.language_ask": "Materiallar tili haqida savol",
  "botTexts.key.language_ask.hint":
    "Mahsulot fayllari bir necha tilda boʻlsa, tillar roʻyxati ustida.",
  "botTexts.key.pay_after": "Toʻlovdan keyin",
  "botTexts.key.pay_after.hint":
    "Buyurtma, summa va rekvizitlar xabarining oxirgi qatori (yetkazib berishsiz mahsulotlar). Odatda shu yerda chek yuborishni soʻrashadi.",
  "botTexts.key.receipt_how_to": "Chekni qanday yuborish",
  "botTexts.key.receipt_how_to.hint":
    "Xaridor chekni qanday yuborishni soʻraganda beriladigan javob.",
  "botTexts.key.receipt_received": "Chek olindi",
  "botTexts.key.receipt_received.hint":
    "Chek rasmidan keyin, pochta kerak boʻlmasa yoki berilmagan boʻlsa.",
  "botTexts.key.receipt_received_email": "Chek olindi, pochta bor",
  "botTexts.key.receipt_received_email.hint":
    "Chek rasmidan keyin, xaridorning pochtasi allaqachon yozilgan boʻlsa.",
  "botTexts.key.receipt_need_email": "Chek olindi, pochta kerak",
  "botTexts.key.receipt_need_email.hint":
    "Chek rasmidan keyin, materiallar pochtaga boradigan boʻlsa va pochta hali yoʻq boʻlsa.",
  "botTexts.key.receipt_manual": "Chek qoʻlda tekshiruvda",
  "botTexts.key.receipt_manual.hint":
    "Chekni avtomatik tekshirish oʻtmadi, buyurtma sizga tasdiqlash uchun yuborildi.",
  "botTexts.key.receipt_verified": "Chek tekshirildi",
  "botTexts.key.receipt_verified.hint": "Chek tekshiruvdan oʻtdi, bot darhol fayllarni yuboradi.",
  "botTexts.key.email_ask": "Pochta haqida savol",
  "botTexts.key.email_ask.hint": "Bot materiallar uchun pochtani soʻraganda.",
  "botTexts.key.email_retry": "Bu pochta emas",
  "botTexts.key.email_retry.hint": "Pochta haqidagi savolga javob manzilga oʻxshamaydi.",
  "botTexts.key.thanks_reply": "«Rahmat»ga javob",
  "botTexts.key.thanks_reply.hint":
    "Xaridor buyurtma topshirilgandan keyin minnatdorchilik bildirdi. Bot bir buyurtmaga bir marta javob beradi, murojaat ochilmaydi.",
  "botTexts.key.foreign_pay_reply": "Boshqa davlatdan to‘lov",
  "botTexts.key.foreign_pay_reply.hint":
    "Xaridor do‘konda to‘lov usuli yo‘q davlatdan (masalan, Belarus, O‘zbekiston, Qirg‘iziston) qanday to‘lashni so‘raydi. Bot sutkada bir marta javob beradi, savol sizga murojaat bo‘lib keladi.",
  "botTexts.vars": "Qoʻyish mumkin: {vars}",
  "botTexts.var.shop": "{shop} — doʻkon nomi",
  "botTexts.var.order": "{order} — buyurtma raqami",
  "botTexts.var.from": "{from} — ish boshlanishi",
  "botTexts.var.to": "{to} — ish tugashi",
  "botTexts.var.email": "{email} — xaridor pochtasi",
  "botTexts.unknownVar": "Bunday almashtirish yoʻq: {name}. U matnda oʻz holicha qoladi.",
  "botTexts.custom": "Oʻz matni",
  "botTexts.standard": "Standart",
  "botTexts.preview": "Xaridor shunday koʻradi",
  "botTexts.save": "Saqlash",
  "botTexts.reset": "Standartga qaytarish",
  "botTexts.saved": "Saqlandi",
  "botTexts.noCustom": "Standart matn",
  "botTexts.hours.title": "Ish vaqti",
  "botTexts.hours.hint":
    "Doʻkonning vaqt mintaqasi boʻyicha. Shu soatlardan tashqari bot «Ish vaqtidan tashqari» matnini yuboradi. Soatlar boʻlmasa, yuborilmaydi.",
  "botTexts.hours.open": "Boshlanishi",
  "botTexts.hours.close": "Tugashi",
  "botTexts.hours.none": "Belgilanmagan",
  "botTexts.hours.save": "Soatlarni saqlash",
  "botTexts.hours.clear": "Soatlarni olib tashlash",
  "botTexts.notWiredConsultant":
    "Bu yerda faqat Telegram-bot matnlari. Instagram va WhatsApp'da xaridorlarga SI-maslahatchi o‘z so‘zlari bilan javob beradi: u qanday gapirishi maslahatchi sahifasida sozlanadi.",
  "botTexts.openConsultant": "Maslahatchi sozlamalarini ochish",
  "botTexts.hours.hintTelegramOnly":
    "Faqat Telegram-bot uchun, do‘kon vaqt mintaqasi bo‘yicha: bu soatlardan tashqari u «Ish vaqtidan tashqari» matnini yuboradi (6 soatda bir martadan ko‘p emas). Instagram va WhatsApp'da bu soatlar amal qilmaydi.",
  "botTexts.hours.hintPricelist":
    "Maslahatchining ish vaqti (undan tashqari u menejer ertalab javob beradi deydi) va u xaridorlarga aytadigan butik ish vaqti — «{page}» sahifasidagi alohida sozlamalar.",
};
