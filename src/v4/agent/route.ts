/**
 * Какая модель отвечает (часть 2 плана, п. 6 «Дешевле и быстрее»): простое —
 * приветствие, «спасибо», «где мой заказ» — быстрая дешёвая модель; всё, где
 * есть товар, цена, выбор, сомнение, фото, — сильная. Правило осторожное:
 * быстрая только когда сообщение целиком из простых фраз. Лишнее слово, цифра,
 * кнопка на последнем ответе бота (тогда «ок» может значить «беру») — сильная.
 * Ответ быстрой модели не прошёл проверку — исправляет сильная (run.ts).
 */

export type ModelRoute = "fast" | "strong";

// Целые фразы на 4 языках. Порядок: длинные раньше коротких («добрый день» до «день»).
const SIMPLE = [
  // ru
  "здравствуйте",
  "здравствуй",
  "добрый день",
  "добрый вечер",
  "доброе утро",
  "доброй ночи",
  "привет",
  "приветствую",
  "салам",
  "спасибо большое",
  "большое спасибо",
  "спасибо",
  "благодарю",
  "до свидания",
  "всего доброго",
  "пока",
  "хорошо",
  "понятно",
  "ясно",
  "ладно",
  "окей",
  "ок",
  "где мой заказ",
  "когда придёт заказ",
  "когда придет заказ",
  "статус заказа",
  "вы бот",
  "ты бот",
  "когда вы работаете",
  "когда ответите",
  // kk
  "сәлеметсіз бе",
  "сәлеметсізбе",
  "қайырлы күн",
  "сәлем",
  "рақмет",
  "рахмет",
  "көп рахмет",
  "жақсы",
  "түсінікті",
  "сау болыңыз",
  "тапсырысым қайда",
  // en
  "good morning",
  "good evening",
  "good afternoon",
  "thank you",
  "thanks",
  "hello",
  "hi",
  "hey",
  "okay",
  "ok",
  "bye",
  "got it",
  "where is my order",
  // uz
  "assalomu alaykum",
  "salom",
  "katta rahmat",
  "rahmat",
  "xop",
  "yaxshi",
  "tushunarli",
  "xayr",
  "buyurtmam qayerda",
].sort((a, b) => b.length - a.length);

/** Только простые фразы, знаки и смайлики — без цифр и без других слов. */
export function isSimpleMessage(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/gu, "е").trim();
  if (!t || t.length > 60 || /\p{N}/u.test(t)) return false;
  let rest = ` ${t.replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/gu, " ")} `;
  for (const p of SIMPLE) {
    const k = ` ${p.replace(/ё/gu, "е")} `;
    while (rest.includes(k)) rest = rest.replace(k, " ");
  }
  return rest.trim() === "";
}

export function routeTurn(a: {
  text: string;
  photo: boolean;
  /** Последний ответ бота показал кнопку: «ок», «хорошо» могут значить «беру». */
  lastReplyHadButtons: boolean;
}): ModelRoute {
  if (a.photo || a.lastReplyHadButtons) return "strong";
  return isSimpleMessage(a.text) ? "fast" : "strong";
}
