import { serverFailure } from "@/lib/server-failure";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Витринные картинки из закрытого бакета product-images. Ключ обязан лежать
 * под префиксом bot_id из адреса — изоляция хранилища держится на путях.
 * Только клиенты на v2 (servedByV2): картинки клиента v1 отдаёт v1.
 */
export const Route = createFileRoute("/api/img/$botId/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const botId = params.botId;
        const { decodeImageKey, parseImageWidth } = await import("@/core/catalog/image-url");
        const width = parseImageWidth(new URL(request.url).searchParams.get("w"));
        const rel = decodeImageKey(params._splat ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(botId) || !rel)
          return new Response("not found", { status: 404 });
        // Клиент прежней платформы для v2 невидим (правило 6): его картинки отдаёт v1.
        const { resolveTenant } = await import("@/core/tenant/resolve.server");
        const { servedByV2 } = await import("@/core/tenant/directory");
        const tenant = await resolveTenant({ by: "id", value: botId });
        if (!tenant || !servedByV2(tenant)) return new Response("not found", { status: 404 });
        const { serviceDb } = await import("@/core/db/client.server");
        const storage = serviceDb().storage.from("product-images");
        // Новый ключ с префиксом арендатора; если такого нет — старый ключ без
        // префикса, но только когда строка product_images подтверждает, что
        // он принадлежит этому арендатору.
        // Уменьшенная копия — средствами Storage; не вышло (тариф без преобразований,
        // не картинка) — молча отдаём оригинал, витрина не должна терять фото.
        let first = width
          ? await storage.download(`${botId}/${rel}`, { transform: { width, quality: 75 } })
          : null;
        if (first?.error) {
          console.warn(`[img] ${botId}/${rel}?w=${width}: ${first.error.message}`);
          first = null;
        }
        first ??= await storage.download(`${botId}/${rel}`);
        let file = first.data;
        if (first.error) console.warn(`[img] ${botId}/${rel}: ${first.error.message}`);
        if (!file) {
          const { data: owned, error: ownedError } = await serviceDb()
            .from("product_images")
            .select("id")
            .eq("bot_id", botId)
            .eq("image_path", rel)
            .limit(1)
            .maybeSingle();
          if (ownedError) throw serverFailure(`Картинки: ${ownedError.message}`);
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
            "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
