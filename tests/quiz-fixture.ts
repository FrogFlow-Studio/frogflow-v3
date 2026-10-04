/**
 * Один квиз и каталог для проверки «одинаковые ответы — одинаковый результат»
 * в Telegram, Instagram/WhatsApp и на витрине (channels/quiz-channels.test.ts,
 * app/storefront/quiz.functions.test.ts).
 */
export const QUIZ_TENANT = "bbbbbbbb-0000-4000-8000-000000000001";
export const QP1 = "a0000000-0000-4000-8000-000000000001";
export const QP2 = "a0000000-0000-4000-8000-000000000002";
export const QP3 = "a0000000-0000-4000-8000-000000000003";
export const QP4 = "a0000000-0000-4000-8000-000000000004";

export const QUIZ_JSON = JSON.stringify({
  intro: "Подберём за минуту",
  questions: [
    {
      text: "Для кого?",
      options: [
        { label: "Детям", tags: "дет" },
        { label: "Взрослым", tags: "взросл" },
      ],
    },
    {
      text: "Что нужно?",
      options: [
        { label: "Прописи", tags: "пропис" },
        { label: "Пазлы", tags: "пазл" },
      ],
    },
  ],
});

/** Детям и прописи: «Прописи для детей» набирает два тега, «Пазлы детские» — один. */
export const QUIZ_ANSWERS = [0, 0];
export const QUIZ_EXPECTED = [QP1, QP2];

const product = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  keywords: null,
  description: null,
  is_active: true,
  stock_quantity: null,
  category_id: null,
  category_ids: [],
  price: 1000,
  currency: "KZT",
  country_prices: {},
  fulfillment_kind: "digital",
  sort_order: 0,
  product_images: [],
  product_variants: [],
  ...extra,
});

export function quizProducts() {
  return [
    product(QP1, "Прописи для детей"),
    product(QP2, "Пазлы детские"),
    product(QP3, "Ежедневник", { keywords: "взросл" }),
    // Подходит по тегам, но закончился на складе — в подборе не участвует.
    product(QP4, "Прописи детские, редкие", { stock_quantity: 0 }),
  ];
}
