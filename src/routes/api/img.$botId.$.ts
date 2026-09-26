import { createFileRoute } from "@tanstack/react-router";

/**
 * Витринные картинки из закрытого бакета product-images. Ключ обязан лежать
 * под префиксом bot_id из адреса — изоляция хранилища держится на путях.
 */
export const Route = createFileRoute("/api/img/$botId/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const botId = params.botId;
        const { decodeImageKey } = await import("@/core/catalog/image-url");
        const rel = decodeImageKey(params._splat ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(botId) || !rel)
          return new Response("not found", { status: 404 });
        const { serviceDb } = await import("@/core/db/client.server");
        const storage = serviceDb().storage.from("product-images");
        // Новый ключ с префиксом арендатора; если такого нет — старый ключ без
        // префикса, но только когда строка product_images подтверждает, что
        // он принадлежит этому арендатору.
        const first = await storage.download(`${botId}/${rel}`);
        let file = first.data;
        if (first.error) console.warn(`[img] ${botId}/${rel}: ${first.error.message}`);
        if (!file) {
          const { data: owned } = await serviceDb()
            .from("product_images")
            .select("id")
            .eq("bot_id", botId)
            .eq("image_path", rel)
            .limit(1)
            .maybeSingle();
          if (owned) file = (await storage.download(rel)).data;
        }
        if (!file) return new Response("not found", { status: 404 });
        // Файл браузер кладёт в бакет сам, тип задаёт тоже он. Картинку отдаём
        // с её типом, всё прочее (HTML, SVG) — как скачиваемый файл, чтобы он
        // не стал страницей нашего домена. Пустой тип, как и раньше, — JPEG.
        const raw = file.type || "image/jpeg";
        const type = /^image\/(?!svg)[\w.+-]+$/i.test(raw) ? raw : null;
        return new Response(file, {
          headers: {
            "content-type": type ?? "application/octet-stream",
            ...(type ? {} : { "content-disposition": "attachment" }),
            "cache-control": "public, max-age=3600",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
