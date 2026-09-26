import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ srcDirectory: "src", server: { entry: "server" } }),
    nitro({
      vercel: {
        // Одна функция на всё. Отдельные функции (vercel.functionRules) Nitro
        // собирает копией основной, и в копии node_modules/tslib — ссылка по
        // абсолютному пути сборочной машины: на Vercel её нет. С тех пор как
        // pdf-lib принёс вторую версию tslib, все /_serverFn, вебхуки и кроны
        // отвечали 500, а главная падала в «Something went wrong!».
        // Вебхуки каналов выдают файлы крупного заказа минутами, кроны — дольше.
        functions: { maxDuration: 120 },
      },
    }),
    viteReact(),
  ],
});
