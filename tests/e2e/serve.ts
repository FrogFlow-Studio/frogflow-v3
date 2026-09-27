/**
 * Поднимает для сквозного прогона собранное приложение (node-server) рядом с
 * подставной Supabase, Telegram, Zernio и Anthropic (pg-stub.ts) с демо-магазином (seed.ts).
 * Секреты — заглушки: настоящих ключей здесь нет и не нужно, в базу прогон не
 * ходит.
 */
import { spawn } from "node:child_process";
import {
  E2E_PORT,
  SECRETS_KEY,
  STUB,
  STUB_PORT,
  WEBHOOK_SECRET,
  ZERNIO_WEBHOOK_SECRET,
} from "./fixtures.ts";
import { startPgStub } from "./pg-stub.ts";
import { seedDb } from "./seed.ts";

await startPgStub(STUB_PORT, seedDb());
const app = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "inherit",
  env: {
    PATH: process.env.PATH,
    HOST: "127.0.0.1",
    PORT: String(E2E_PORT),
    APP_URL: `http://127.0.0.1:${E2E_PORT}`,
    SUPABASE_URL: STUB,
    TELEGRAM_API_BASE: STUB,
    ZERNIO_BASE_URL: `${STUB}/zernio/v1`,
    ZERNIO_API_KEY: "e2e-zernio-key",
    ZERNIO_WEBHOOK_SECRET,
    // Консультант: SDK Anthropic берёт адрес из ANTHROPIC_BASE_URL — подставная модель.
    ANTHROPIC_API_KEY: "e2e-anthropic-key",
    ANTHROPIC_BASE_URL: `${STUB}/anthropic`,
    SUPABASE_PUBLISHABLE_KEY: "e2e",
    SUPABASE_SERVICE_ROLE_KEY: "e2e",
    SUPABASE_JWT_SECRET: "e2e-jwt-secret-e2e-jwt-secret-0000",
    SECRETS_KEY,
    SESSION_SECRET: "e2e-session-secret-e2e-session-secret-00",
    WEBHOOK_SECRET,
    CRON_SECRET: "e2e-cron-secret-0000",
    SIGNUP_ENABLED: "1",
  },
});
app.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.kill(sig));
