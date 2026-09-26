/**
 * Поднимает для сквозного прогона собранное приложение (node-server) рядом с
 * подставной Supabase. Секреты — заглушки: настоящих ключей здесь нет и не
 * нужно, в базу прогон не ходит.
 */
import { spawn } from "node:child_process";
import { startSupabaseStub } from "./supabase-stub.ts";

export const E2E_PORT = 3100;
const STUB_PORT = 54329;

await startSupabaseStub(STUB_PORT);
const app = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "inherit",
  env: {
    PATH: process.env.PATH,
    HOST: "127.0.0.1",
    PORT: String(E2E_PORT),
    APP_URL: `http://127.0.0.1:${E2E_PORT}`,
    SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    SUPABASE_PUBLISHABLE_KEY: "e2e",
    SUPABASE_SERVICE_ROLE_KEY: "e2e",
    SUPABASE_JWT_SECRET: "e2e-jwt-secret-e2e-jwt-secret-0000",
    SECRETS_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SESSION_SECRET: "e2e-session-secret-e2e-session-secret-00",
    WEBHOOK_SECRET: "e2e-webhook-secret-e2e-webhook-secret-00",
    CRON_SECRET: "e2e-cron-secret-0000",
    SIGNUP_ENABLED: "1",
  },
});
app.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.kill(sig));
