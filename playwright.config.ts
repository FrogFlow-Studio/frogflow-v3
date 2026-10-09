import { defineConfig, devices } from "@playwright/test";

/**
 * Сквозной прогон в браузере: собранное приложение (как на проде, только
 * пресет node-server) против подставной базы. Сборка — отдельным шагом:
 * `NITRO_PRESET=node-server npx vite build && npm run e2e`.
 */
// Один «сегодня» на весь прогон: конфиг читается до запуска сервера с сидом и воркеров, оба
// наследуют окружение. Иначе даты, посчитанные от «сейчас», расходятся на прогоне через полночь UTC.
process.env.E2E_RUN_DAY ??= new Date().toISOString().slice(0, 10);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node tests/e2e/serve.ts",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
