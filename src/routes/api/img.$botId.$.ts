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
        const rel = params._splat ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(botId) || !rel || rel.includes("..")) {
          return new Response("not found", { status: 404 });
        }
        const { serviceDb } = await import("@/core/db/client.server");
        const storage = serviceDb().storage.from("product-images");
        // Новый ключ с префиксом арендатора; если такого нет — старый ключ без
        // префикса, но только когда строка product_images подтверждает, что
        // он принадлежит этому арендатору.
        let file = (await storage.download(`${botId}/${rel}`)).data;
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
        return new Response(file, {
          headers: {
            "content-type": file.type || "image/jpeg",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
