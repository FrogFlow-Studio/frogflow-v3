/**
 * Клиент с ИИ-консультантом в Instagram Direct (seed/consultant.ts): свой
 * аккаунт Zernio и подставной Anthropic (pg-stub, /anthropic).
 */
export const CONS_ID = "e2e00000-0000-4000-8000-000000000004";
export const CONS_NAME = "Консультант E2E";
export const CONS_BOT_TOKEN = "700000004:E2E-consultant-token";
export const CONS_SELLER_TG = 500000004;
export const CONS_IG_ACCOUNT = "e2e-ig-consultant";
export const CONS_IG_PROFILE = "e2e-zernio-profile-consultant";
/** Ответ подставной модели на обычный вопрос: без цифр — сверка цен его пропускает. */
export const CONS_ANSWER =
  "Полотенца у нас из хлопка, мягкие и плотные. Подсказать с выбором цвета?";
/** Слово, на которое подставная модель передаёт диалог менеджеру. */
export const CONS_HANDOFF_WORD = "менеджер";
export const CONS_HANDOFF_SUMMARY = "Клиент просит связать с менеджером по оптовому заказу.";
