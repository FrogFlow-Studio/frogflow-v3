import { defineConfig, devices } from "@playwright/test";

/**
 * Сквозной прогон в браузере: собранное приложение (как на проде, только
 * пресет node-server) против подставной базы. Сборка — отдельным шагом:
 * `NITRO_PRESET=node-server npx vite build && npm run e2e`.
 */
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
