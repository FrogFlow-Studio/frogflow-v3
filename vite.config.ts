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
        functionRules: {
          // Вебхуки каналов: выдача файлов крупного заказа может занять минуты.
          "/api/telegram/**": { maxDuration: 60 },
          "/api/zernio/**": { maxDuration: 60 },
          "/api/cron/**": { maxDuration: 120 },
          "/_serverFn/**": { maxDuration: 60 },
        },
      },
    }),
    viteReact(),
  ],
});
