import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";
import { parseProfile } from "./prompt";
import type { BuyerLang } from "./texts";

/**
 * Готовность магазина к ИИ-продавцу: оценка 0–100 и подсказки продавцу, что
 * заполнить (после переноса из v3 новые поля пустые — Спецификация, раздел 3).
 * Вес — по тому, как часто без этого бот передаёт вопрос продавцу или
 * отвечает простым ответом. 4 языка (CLAUDE.md).
 */

export const READINESS_ITEMS = [
  "payment_terms",
  "delivery_terms",
  "about",
  "descriptions",
  "payment_methods",
  "wallet",
  "work_hours",
  "advantages",
  "voice",
  "knowledge_review",
] as const;
export type ReadinessItem = (typeof READINESS_ITEMS)[number];

const WEIGHT: Record<ReadinessItem, number> = {
  payment_terms: 20,
  delivery_terms: 15,
  about: 10,
  descriptions: 20,
  payment_methods: 10,
  wallet: 10,
  work_hours: 5,
  advantages: 5,
  voice: 5,
  knowledge_review: 0,
};

export const READINESS_HINTS: Record<ReadinessItem, Record<BuyerLang, string>> = {
  payment_terms: {
    ru: "Напишите условия оплаты — без них бот передаёт вопрос «как оплатить» вам.",
    kk: "Төлем шарттарын жазыңыз — оларсыз бот «қалай төлеймін» сұрағын сізге жібереді.",
    en: "Add payment terms — without them the bot passes “how do I pay” to you.",
    uz: "To'lov shartlarini yozing — ularsiz bot «qanday to'layman» savolini sizga yuboradi.",
  },
  delivery_terms: {
    ru: "Напишите, как покупатель получает товар и за какой срок.",
    kk: "Сатып алушы тауарды қалай және қанша уақытта алатынын жазыңыз.",
    en: "Describe how and how fast the buyer receives the item.",
    uz: "Xaridor mahsulotni qanday va qancha vaqtda olishini yozing.",
  },
  about: {
    ru: "Опишите магазин в двух-трёх предложениях: что продаёте и для кого.",
    kk: "Дүкенді екі-үш сөйлеммен сипаттаңыз: не сатасыз және кімге.",
    en: "Describe the shop in two or three sentences: what you sell and to whom.",
    uz: "Do'konni ikki-uch gapda tasvirlang: nima sotasiz va kimga.",
  },
  descriptions: {
    ru: "Добавьте описания товарам — бот отвечает «что входит» из карточки.",
    kk: "Тауарларға сипаттама қосыңыз — бот «ішінде не бар» сұрағына карточкадан жауап береді.",
    en: "Add product descriptions — the bot answers “what’s included” from the card.",
    uz: "Mahsulotlarga tavsif qo'shing — bot «ichida nima bor» savoliga kartochkadan javob beradi.",
  },
  payment_methods: {
    ru: "Подключите хотя бы один способ оплаты.",
    kk: "Кемінде бір төлем тәсілін қосыңыз.",
    en: "Connect at least one payment method.",
    uz: "Kamida bitta to'lov usulini ulang.",
  },
  wallet: {
    ru: "Пополните баланс ИИ — при нуле бот отвечает простыми ответами.",
    kk: "ЖИ балансын толтырыңыз — нөл болса, бот қарапайым жауап береді.",
    en: "Top up the AI balance — at zero the bot sends simple replies only.",
    uz: "SI balansini to'ldiring — nolda bot oddiy javoblar beradi.",
  },
  work_hours: {
    ru: "Укажите, когда вы отвечаете — бот скажет покупателю точное время.",
    kk: "Қашан жауап беретініңізді көрсетіңіз — бот сатып алушыға нақты уақытты айтады.",
    en: "Say when you reply — the bot will tell the buyer the exact time.",
    uz: "Qachon javob berishingizni yozing — bot xaridorga aniq vaqtni aytadi.",
  },
  advantages: {
    ru: "Напишите, чем вы лучше других — бот скажет, если спросят «почему у вас».",
    kk: "Сіз несімен жақсы екеніңізді жазыңыз — «неге сізден» деп сұраса, бот айтады.",
    en: "Say why buy from you — the bot uses it when asked “why you”.",
    uz: "Nega aynan sizdan olish kerakligini yozing — bot «nega sizdan» deb so'rashsa aytadi.",
  },
  voice: {
    ru: "Добавьте 2–3 своих ответа покупателям — бот переймёт манеру.",
    kk: "Сатып алушыларға 2–3 өз жауабыңызды қосыңыз — бот мәнерін үйренеді.",
    en: "Add 2–3 of your replies to buyers — the bot will copy your manner.",
    uz: "Xaridorlarga 2–3 ta javobingizni qo'shing — bot uslubingizni o'rganadi.",
  },
  knowledge_review: {
    ru: "Проверьте ответы с телефоном, почтой или суммой — пока вы не подтвердите, бот их не использует.",
    kk: "Телефон, пошта не сома бар жауаптарды тексеріңіз — растамайынша бот оларды қолданбайды.",
    en: "Review answers with a phone, email or amount — the bot won’t use them until you confirm.",
    uz: "Telefon, pochta yoki summa bor javoblarni tekshiring — tasdiqlamaguningizcha bot ulardan foydalanmaydi.",
  },
};

export type Readiness = {
  score: number;
  missing: ReadinessItem[];
  descriptions: { described: number; total: number };
  knowledgeReview: number;
};

export async function sellerReadiness(db: V4Db, botId: string): Promise<Readiness | null> {
  const r = (await db.call("seller_readiness", { p_bot_id: botId }))[0]?.seller_readiness as
    Record<string, unknown> | null | undefined;
  if (r === undefined) throw serverFailure("v4.seller_readiness: пустой ответ");
  if (!r) return null;
  return readinessOf(r);
}

export function readinessOf(r: Record<string, unknown>): Readiness {
  const p = parseProfile(r.profile);
  const total = Number(r.products);
  const described = Number(r.products_described);
  const review = Number(r.knowledge_review);
  const ok: Record<ReadinessItem, boolean> = {
    payment_terms: Boolean(p.payment_terms),
    delivery_terms: Boolean(p.delivery_terms),
    about: Boolean(p.about),
    // Описана хотя бы половина товаров (вариант описывается у родителя).
    descriptions: total > 0 && described * 2 >= total,
    payment_methods: Number(r.payment_methods) > 0,
    wallet: Number(r.wallet_micro_usd) > 0,
    work_hours: Boolean(p.work_hours_note),
    advantages: Boolean(p.advantages),
    voice: Boolean(p.voice_examples),
    knowledge_review: review === 0,
  };
  const missing = READINESS_ITEMS.filter((k) => !ok[k]);
  const score = READINESS_ITEMS.reduce((sum, k) => sum + (ok[k] ? WEIGHT[k] : 0), 0);
  return { score, missing, descriptions: { described, total }, knowledgeReview: review };
}
