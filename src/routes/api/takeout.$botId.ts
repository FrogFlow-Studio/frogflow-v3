import { createFileRoute } from "@tanstack/react-router";

/**
 * «Забрать мои данные»: архив магазина по подписанной ссылке на 24 часа
 * (core/export/takeout). Ссылку выдаёт владелец в админке; здесь сессии нет,
 * доступ даёт подпись. Только клиенты на v2 (servedByV2) и не архивные.
 */
export const Route = createFileRoute("/api/takeout/$botId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const botId = params.botId;
        if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
        const { env } = await import("@/config/env");
        const { checkTakeout, takeoutZip } = await import("@/core/export/takeout");
        const q = new URL(request.url).searchParams;
        const check = checkTakeout(env().SESSION_SECRET, botId, q.get("e"), q.get("k"));
        if (check === "expired") return new Response("link expired", { status: 410 });
        if (check !== "ok") return new Response("not found", { status: 404 });
        const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
        const { servedByV2 } = await import("@/core/tenant/directory");
        const tenant = await resolveTenant({ by: "id", value: botId });
        if (!tenant || tenant.archived || !servedByV2(tenant))
          return new Response("not found", { status: 404 });
        const { zip } = await takeoutZip(tenantContext(tenant));
        const today = new Date().toISOString().slice(0, 10);
        return new Response(new Uint8Array(zip), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="shop-data-${today}.zip"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
