import { defineConfig } from "vitest/config";

// Отдельный конфиг, а не vite.config.ts: там подключены TanStack Start и
// Nitro, которые собирают приложение целиком — тестам это не нужно.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
