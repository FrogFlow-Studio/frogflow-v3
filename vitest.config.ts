import { defineConfig } from "vitest/config";

// Отдельный конфиг, а не vite.config.ts: там подключены TanStack Start и
// Nitro, которые собирают приложение целиком — тестам это не нужно.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 30_000,
    projects: [
      // Обычные тесты: файлы параллельно, по ядру на файл.
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["tests/integration/**", "**/node_modules/**"],
        },
      },
      // Живые тесты ходят в одну базу и один демо-клиент: параллельные файлы
      // затирали друг другу товары и покупателей (счётчик товаров, корзина).
      {
        extends: true,
        test: {
          name: "live",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
