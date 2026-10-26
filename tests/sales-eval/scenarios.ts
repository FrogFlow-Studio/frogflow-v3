import type { SalesScenario } from "./checks";

/**
 * Набор продаж: реплики настоящих покупателей Копилки Русоведа в WhatsApp
 * (21–25.10, без имён и телефонов). Покупатель говорит то же, что сказал тогда,
 * бот отвечает заново на живой модели. Ожидания — то, что сделал бы сильный
 * продавец: коротко, кнопка «Купить» под выбранным товаром, без «Оформляем
 * заказ?», без заготовок и без передачи менеджеру там, где ответ в карточке.
 *
 * Товары — из снимка каталога Копилки (SALES_EVAL_SNAPSHOT): названия ниже
 * совпадают с карточками на 26.10.
 */
export const SALES_SCENARIOS: SalesScenario[] = [
  {
    id: "ladders-intro-click",
    title: "«Интересуют лестницы» → коротко, кнопка, нажатие оформляет заказ",
    origin:
      "Копилка, WhatsApp 23.10: 6 человек с этой фразой, все замолчали после «Оформляем заказ?»",
    locale: "ru",
    turns: [
      {
        text: 'Здравствуйте. Интересуют лестницы "Части речи и члены предложения".',
        expect: { buy: "offer", maxChars: 450, noQuestionEnd: true },
      },
      { click: "buy", expect: { buy: "order" } },
    ],
  },
  {
    id: "class-teacher-folder-intro",
    title: "«Интересует папка классного руководителя» → кнопка без вопроса",
    origin: "Копилка, WhatsApp 23.10: 7 человек, ни одного заказа",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте. Интересует папка классного руководителя.",
        expect: { buy: "offer", maxChars: 450, noQuestionEnd: true },
      },
    ],
  },
  {
    id: "class-teacher-folder-price",
    title: "«…Сколько стоит?» → цена и кнопка",
    origin: "Копилка, WhatsApp 23.10 09:24",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте. Интересует папка классного руководителя. Сколько стоит?",
        expect: { buy: "offer", maxChars: 400, noQuestionEnd: true, must: [/3\s?500/u] },
      },
    ],
  },
  {
    id: "palette-paper",
    title: "«На какой бумаге печатать?» — ответ из карточки (А4 и А3), не менеджеру",
    origin: "Копилка, WhatsApp 23.10 08:54: бот сказал «в описании нет» и предложил менеджера",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте. Интересует палитра средств выразительности.",
        expect: { buy: "offer", maxChars: 450 },
      },
      {
        text: "На какой бумаге его можно будет распечатать?",
        expect: { must: [/[АA]4/u], maxChars: 400 },
      },
    ],
  },
  {
    id: "formative-class-choice",
    title: "Сборники формативного оценивания → выбор класса = кнопка на этот класс",
    origin: "Копилка, WhatsApp 23.10 06:27: «У меня 5 класс» → «Оформляем заказ?» → тишина",
    locale: "ru",
    reachOffer: true,
    turns: [
      {
        text: "Здравствуйте. Интересуют сборники формативного оценивания.",
        expect: { buy: "any", maxChars: 600 },
      },
      { text: "У меня 5 класс", expect: { maxChars: 400 } },
      { text: "По русскому языку", expect: { buy: "offer", maxChars: 400 } },
    ],
  },
  {
    id: "reflection-yes-places-order",
    title: "«Да, оформляем» после рассказа о товаре → заказ, не «Уточните…»",
    origin:
      "Копилка, WhatsApp 23.10 12:29: на «Да, оформляем», «Да» и «Вот оплата» бот четыре раза ответил «Уточните, пожалуйста, что именно вас интересует»",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте! Интересует набор рефлексии для урока.",
        expect: { buy: "offer", maxChars: 500 },
      },
      { text: "Да, оформляем", expect: { buy: "order" } },
      { text: "За какой срок придет?", expect: { maxChars: 350 } },
    ],
  },
  {
    id: "reflection-subject-fit",
    title: "«Мне на урок русского и литературы» → подходит, кнопка",
    origin: "Копилка, WhatsApp 23.10 10:41",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте! Интересует набор рефлексии для урока.",
        expect: { buy: "offer", maxChars: 500 },
      },
      {
        text: "Мне нужно на урок русского языка и литературы",
        expect: { maxChars: 350, noQuestionEnd: true },
      },
    ],
  },
  {
    id: "palette-cheaper",
    title: "«Подешевле дайте» → дешёвый вариант из каталога, без менеджера",
    origin: "Копилка, WhatsApp 23.10 11:02",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте. Интересует палитра средств выразительности.",
        expect: { buy: "offer" },
      },
      { text: "По дешевле дайте пожалуйста", expect: { maxChars: 500 } },
    ],
  },
  {
    id: "formative-no-time",
    title: "«Нету времени» → без новых вопросов, коротко",
    origin: "Копилка, WhatsApp 23.10 12:30: бот задал ещё вопрос → «Не надо пока»",
    locale: "ru",
    turns: [
      { text: "Здравствуйте. Интересуют сборники формативного оценивания." },
      { text: "Нету времени", expect: { maxChars: 250, noQuestionEnd: true } },
    ],
  },
  {
    id: "formative-several-classes",
    title: "Несколько классов «5-6-7» → одна покупка на сумму, не менеджеру",
    origin: "Копилка, WhatsApp 23.10 12:42: «5-6_7» → «Точную стоимость уточню у менеджера»",
    locale: "ru",
    reachOffer: true,
    turns: [
      { text: "Здравствуйте. Интересуют сборники формативного оценивания по русскому языку." },
      { text: "5-6_7", expect: { maxChars: 450 } },
    ],
  },
  {
    id: "kk-class-teacher-folder-contents",
    title: "Қазақша: сынып жетекші папкасы, «нақты тізім» — состав из карточки",
    origin:
      "Копилка, WhatsApp 23.10 00:21–00:35: на «Тізімі барма» и «Нақты тізім керек» бот передал менеджеру, покупательница ушла",
    locale: "kk",
    turns: [
      { text: "Қазақша есть", expect: { kazakh: true, maxChars: 300 } },
      { text: "Маған сынып жетекші папкасы керек", expect: { kazakh: true, buy: "offer" } },
      { text: "Тізімі барма", expect: { kazakh: true, maxChars: 600 } },
    ],
  },
  {
    id: "want-to-buy-folder",
    title: "«Хотела купить папку» → заказ, «что входит» → состав",
    origin:
      "Копилка, WhatsApp 25.10 11:50: дважды «Пока заказ не оформлен. Что именно вы хотели узнать?»",
    locale: "ru",
    turns: [
      { text: "Здравствуйте. Интересует папка классного руководителя.", expect: { buy: "offer" } },
      { text: "Что туда входит?", expect: { must: [/раздел|памятк|таблиц/iu], maxChars: 600 } },
      { text: "Хотела купить папку", expect: { buy: "order" } },
    ],
  },
  {
    id: "mo-folder-kz",
    title: "Папка МО ЕМН → вариант для Казахстана → кнопка",
    origin:
      "Копилка, WhatsApp 21.10 16:17: «такой папки нет» (товар тогда не был в каталоге, теперь есть)",
    locale: "ru",
    reachOffer: true,
    turns: [
      { text: "Документация (папка) МО ЕМН интересует. Что стоит?", expect: { maxChars: 450 } },
      { text: "Для Казахстана", expect: { buy: "offer", maxChars: 400 } },
    ],
  },
  {
    id: "greeting-only",
    title: "«Добрый вечер» → короткий вопрос, без каталога и кнопки",
    origin: "Копилка, WhatsApp 21.10 16:15",
    locale: "ru",
    turns: [{ text: "Добрый вечер👋", expect: { buy: "none", maxChars: 250 } }],
  },
  {
    id: "custom-order",
    title: "Индивидуальный заказ → честно «не делаем», без обещаний",
    origin: "Копилка, WhatsApp 23.10 08:55",
    locale: "ru",
    turns: [
      {
        text: "Здравствуйте! Вы можете сделать заказ индивидуальный?",
        expect: { buy: "none", maxChars: 400 },
      },
    ],
  },
  {
    id: "pay-by-halyk-number",
    title: "«Можно по номеру Народного?» после лестниц — спокойный ответ про оплату",
    origin: "Копилка, WhatsApp 23.10 14:23",
    locale: "ru",
    turns: [
      {
        text: 'Здравствуйте. Интересуют лестницы "Части речи и члены предложения".',
        expect: { buy: "offer" },
      },
      { text: "Можно оплатить по номеру Народного банка?", expect: { maxChars: 400 } },
    ],
  },
];
