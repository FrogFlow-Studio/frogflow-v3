/** Общее для интеграционных тестов: живая база, гейт по окружению. */
export const DEMO_BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f"; // «Демо-тестер»
export const OTHER_BOT = "0bac1f86-5231-4e57-838d-2faa44d427e7"; // Educational Bot
export const TEST_TG_ID = 990000001; // синтетический покупатель для записи

export const liveReady = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_JWT_SECRET,
);
