import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Локальный .env для интеграционных тестов; уже заданные переменные не трогаем.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}

// В окружении проекта заданы только ключи Supabase: платформенным секретам,
// которые живым тестам не нужны по сути (адрес деплоя, подписи, шифрование
// токенов — у демо-клиента своего бота нет), даём разовые значения на прогон.
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const oneOff = () => randomBytes(32).toString("hex");
  const defaults: Record<string, () => string> = {
    APP_URL: () => "https://live-test.invalid",
    SUPABASE_PUBLISHABLE_KEY: () => "unused-in-tests",
    SECRETS_KEY: oneOff,
    SESSION_SECRET: oneOff,
    WEBHOOK_SECRET: oneOff,
    CRON_SECRET: oneOff,
  };
  for (const [k, make] of Object.entries(defaults)) process.env[k] ??= make();
}

// Подставная база (tests/fake-db.ts) копит обращения к несуществующим
// колонкам — даже те, чью ошибку код поймал и проглотил. Такой тест не зелёный.
const { afterEach, expect } = await import("vitest");
const { schemaViolations } = await import("./fake-db");
afterEach(() => {
  const found = schemaViolations.splice(0);
  expect(found, "обращение к несуществующей колонке").toEqual([]);
});
