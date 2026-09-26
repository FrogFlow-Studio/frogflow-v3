import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".nitro", ".tanstack", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Узкий неразрывный пробел (U+202F) в подписях «10 000 ₸» — верная
      // русская типографика, но только в тексте JSX; в коде это ошибка.
      "no-irregular-whitespace": ["error", { skipJSXText: true }],
      // Ядро не читает окружение само — арендатор и секреты приходят
      // параметрами. Единственное место чтения process.env — src/config.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "process.env читается только в src/config/env.ts — остальной код получает настройки параметрами.",
        },
      ],
    },
  },
  {
    files: [
      "src/config/**",
      "vite.config.ts",
      "vitest.config.ts",
      "playwright.config.ts",
      "tests/**",
      "src/**/*.test.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // useSession из @tanstack/react-start/server — не React-хук.
    files: ["**/*.server.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
);
