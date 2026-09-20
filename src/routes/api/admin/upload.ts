import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";

const KINDS = {
  image: { bucket: "product-images", max: 20 * 1024 * 1024, types: /^image\/(jpeg|png|gif|webp)$/ },
  file: { bucket: "product-files", max: 200 * 1024 * 1024, types: /.*/ },
} as const;

/** Загрузка в общие бакеты — ключ всегда под префиксом клиента. */
export const Route = createFileRoute("/api/admin/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdmin } = await import("@/app/auth/guards.server");
        let ctx;
        try {
          ctx = await requireAdmin();
        } catch {
          return new Response("unauthorized", { status: 401 });
        }
        const form = await request.formData().catch(() => null);
        const kind = form?.get("kind");
        const file = form?.get("file");
        if (!form || (kind !== "image" && kind !== "file") || !(file instanceof File))
          return new Response("bad request", { status: 400 });
        const spec = KINDS[kind];
        if (file.size > spec.max)
          return Response.json(
            { error: `Файл больше ${Math.round(spec.max / 1024 / 1024)} МБ` },
            { status: 413 },
          );
        if (!spec.types.test(file.type))
          return Response.json({ error: "Неподдерживаемый тип файла" }, { status: 415 });
        const ext =
          (file.name.split(".").pop() || "bin")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 8) || "bin";
        const key = `${ctx.tenant.id}/${randomBytes(12).toString("hex")}.${ext}`;
        const { serviceDb } = await import("@/core/db/client.server");
        const { error } = await serviceDb()
          .storage.from(spec.bucket)
          .upload(key, file, { contentType: file.type || "application/octet-stream" });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ key, name: file.name, size: file.size });
      },
    },
  },
});
