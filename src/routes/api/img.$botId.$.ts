import { createFileRoute } from "@tanstack/react-router";

/**
 * Витринные картинки из закрытого бакета product-images. Ключ обязан лежать
 * под префиксом bot_id из адреса — изоляция хранилища держится на путях.
 */
export const Route = createFileRoute("/api/img/$botId/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = `${params.botId}/${params._splat ?? ""}`;
        if (!/^[0-9a-f-]{36}\/[^\s]+$/i.test(key) || key.includes(".."))
          return new Response("not found", { status: 404 });
        const { serviceDb } = await import("@/core/db/client.server");
        const { data, error } = await serviceDb().storage.from("product-images").download(key);
        if (error || !data) return new Response("not found", { status: 404 });
        return new Response(data, {
          headers: {
            "content-type": data.type || "image/jpeg",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
