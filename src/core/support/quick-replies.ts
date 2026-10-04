import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/**
 * Быстрые ответы оператора (Ч4): готовые тексты на четырёх языках, вставка в
 * поле ответа одним кликом. Текст подставляется на языке магазина клиента,
 * переменные — данные клиента из справочника. Оператор может править текст
 * до отправки: вставка не отправляет сообщение.
 *
 * Шаблоны лежат в коде, а не в базе: схема не меняется, а тест не даёт
 * забыть язык или написать переменную, которой не существует.
 */
export const QUICK_VARS = ["shop", "plan"] as const;
export type QuickVar = (typeof QUICK_VARS)[number];
export type QuickVars = Record<QuickVar, string>;

export type QuickReply = {
  id: string;
  /** Подпись кнопки для оператора (русская). */
  title: string;
  text: Record<Locale, string>;
};

export const QUICK_REPLIES: readonly QuickReply[] = [
  {
    id: "taken",
    title: "Приняли в работу",
    text: {
      ru: "Здравствуйте! Приняли ваше обращение по магазину «{shop}» в работу. Ответим, как только разберёмся.",
      kk: "Сәлеметсіз бе! «{shop}» дүкені бойынша өтінішіңізді жұмысқа алдық. Анықтап болысымен жауап береміз.",
      en: "Hello! We have taken your request about the shop “{shop}” into work. We will reply as soon as we have looked into it.",
      uz: "Assalomu alaykum! «{shop}» do‘koni bo‘yicha murojaatingizni ishga oldik. Aniqlashimiz bilan javob beramiz.",
    },
  },
  {
    id: "details",
    title: "Уточнить детали",
    text: {
      ru: "Чтобы разобраться быстрее, пришлите, пожалуйста, скриншот экрана с проблемой и напишите, на какой странице админки это происходит и номер заказа, если вопрос про заказ.",
      kk: "Тезірек анықтау үшін мәселе көрінген экранның скриншотын жіберіңіз, бұл әкімшілік панелінің қай бетінде болатынын және сұрақ тапсырыс туралы болса, тапсырыс нөмірін жазыңыз.",
      en: "To sort this out faster, please send a screenshot of the problem, tell us which admin page it happens on, and give the order number if it is about an order.",
      uz: "Tezroq aniqlash uchun muammo ko‘ringan ekranning skrinshotini yuboring, admin panelning qaysi sahifasida bo‘lishini va savol buyurtma haqida bo‘lsa, buyurtma raqamini yozing.",
    },
  },
  {
    id: "channel-check",
    title: "Проверим подключение канала",
    text: {
      ru: "Проверим подключение Instagram и WhatsApp для «{shop}» со своей стороны. Пока откройте в админке раздел канала и убедитесь, что он показан как подключённый; если нет, напишите нам, на каком шаге остановились.",
      kk: "«{shop}» үшін Instagram және WhatsApp байланысын өз тарапымыздан тексереміз. Әзірге әкімшілік панелінде арна бөлімін ашып, ол қосылған болып көрінетінін тексеріңіз; егер жоқ болса, қай қадамда тоқтағаныңызды жазыңыз.",
      en: "We will check the Instagram and WhatsApp connection for “{shop}” on our side. Meanwhile, open the channel section in the admin and make sure it shows as connected; if not, tell us which step you stopped at.",
      uz: "«{shop}» uchun Instagram va WhatsApp ulanishini o‘z tomonimizdan tekshiramiz. Hozircha adminkada kanal bo‘limini oching va u ulangan deb ko‘rinishini tekshiring; aks holda qaysi qadamda to‘xtaganingizni yozing.",
    },
  },
  {
    id: "billing",
    title: "Оплата тарифа",
    text: {
      ru: "По оплате: сейчас у «{shop}» тариф «{plan}». Историю оплат видно в админке в разделе «История оплат»; если оплатили, а статус не изменился, пришлите чек, и мы проверим.",
      kk: "Төлем бойынша: қазір «{shop}» үшін «{plan}» тарифі. Төлемдер тарихы әкімшілік панелінің «Төлем тарихы» бөлімінде көрінеді; төлеп қойсаңыз да мәртебе өзгермесе, чекті жіберіңіз, тексереміз.",
      en: "About payment: “{shop}” is currently on the “{plan}” plan. The payment history is in the admin under Payment history; if you have paid but the status has not changed, send us the receipt and we will check.",
      uz: "To‘lov bo‘yicha: hozir «{shop}» uchun «{plan}» tarifi. To‘lovlar tarixi adminkaning «To‘lovlar tarixi» bo‘limida ko‘rinadi; to‘lagan bo‘lsangiz-u, holat o‘zgarmagan bo‘lsa, chekni yuboring, tekshiramiz.",
    },
  },
  {
    id: "forwarded",
    title: "Передали разработчикам",
    text: {
      ru: "Передали вопрос разработчикам, это ошибка на нашей стороне. Напишем сюда, как только исправим. Спасибо, что сообщили!",
      kk: "Сұрақты әзірлеушілерге бердік, бұл біздің тараптағы қате. Түзетіп болысымен осында жазамыз. Хабарлағаныңызға рахмет!",
      en: "We have passed this to the developers; it is a bug on our side. We will write here as soon as it is fixed. Thank you for letting us know!",
      uz: "Savolni dasturchilarga uzatdik, bu bizning tomondagi xato. Tuzatishimiz bilan shu yerga yozamiz. Xabar bergansiz uchun rahmat!",
    },
  },
  {
    id: "done",
    title: "Готово, проверьте",
    text: {
      ru: "Готово: исправили у «{shop}». Проверьте, пожалуйста, и дайте знать, если что-то осталось.",
      kk: "Дайын: «{shop}» үшін түзеттік. Тексеріп, бірдеңе қалса, хабарлаңыз.",
      en: "Done: we have fixed it for “{shop}”. Please check and let us know if anything is left.",
      uz: "Tayyor: «{shop}» uchun tuzatdik. Tekshirib ko‘ring va biror narsa qolsa, xabar bering.",
    },
  },
];

const VAR_RE = /\{(\w+)\}/g;

/** Подставляет переменные; неизвестное имя в фигурных скобках остаётся как есть, пустое значение — убирает пробел перед собой. */
export function fillQuickReply(text: string, vars: Partial<QuickVars>): string {
  return text
    .replace(VAR_RE, (whole, name: string) =>
      (QUICK_VARS as readonly string[]).includes(name) ? (vars[name as QuickVar] ?? "") : whole,
    )
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ");
}

/** Текст шаблона на языке клиента; языка нет в списке — русский. */
export function quickReplyText(
  reply: QuickReply,
  locale: Locale | null | undefined,
  vars: Partial<QuickVars>,
): string {
  const l = locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : "ru";
  return fillQuickReply(reply.text[l], vars);
}
