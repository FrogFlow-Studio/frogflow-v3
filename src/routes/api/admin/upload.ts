import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import {
  UPLOAD_KINDS,
  isIssuedUploadKey,
  isUploadKind,
  mb,
  newUploadKey,
  uploadProblem,
  type UploadProblem,
} from "@/core/storage/upload";

const STATUS: Record<UploadProblem, number> = { too_big: 413, bad_type: 415, empty: 400 };

function problem(p: UploadProblem, max: number) {
  return Response.json({ problem: p, mb: mb(max) }, { status: STATUS[p] });
}

/**
 * Загрузка в общие бакеты в два шага, файл мимо функции Vercel:
 * `sign` — проверяет заявленные размер и тип и выдаёт подписанную ссылку на
 * новый ключ под префиксом клиента; браузер кладёт файл прямо в Storage;
 * `confirm` — сверяет то, что легло в бакет, и удаляет файл, если он не
 * проходит по правилам.
 */
export const Route = createFileRoute("/api/admin/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdminRole } = await import("@/app/auth/guards.server");
        let ctx;
        try {
          // Загрузка — это изменение: роль «просмотр» файлы не кладёт.
          ctx = await requireAdminRole("manager");
        } catch {
          return new Response("unauthorized", { status: 401 });
        }
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const kind = body?.kind;
        if (!body || !isUploadKind(kind)) return new Response("bad request", { status: 400 });
        const spec = UPLOAD_KINDS[kind];
        const { serviceDb } = await import("@/core/db/client.server");
        const bucket = serviceDb().storage.from(spec.bucket);

        if (body.action === "sign") {
          const p = uploadProblem(kind, Number(body.size), String(body.type ?? ""));
          if (p) return problem(p, spec.max);
          const key = newUploadKey(
            ctx.tenant.id,
            randomBytes(12).toString("hex"),
            String(body.name ?? ""),
          );
          const { data, error } = await bucket.createSignedUploadUrl(key);
          if (error || !data) return Response.json({ error: error?.message }, { status: 500 });
          return Response.json({ key, url: data.signedUrl });
        }

        if (body.action === "confirm") {
          const key = String(body.key ?? "");
          if (!isIssuedUploadKey(ctx.tenant.id, key))
            return new Response("bad request", { status: 400 });
          const { data, error } = await bucket.info(key);
          if (error || !data) return Response.json({ problem: "not_stored" }, { status: 404 });
          const p = uploadProblem(kind, Number(data.size), String(data.contentType ?? ""));
          if (p) {
            await bucket.remove([key]);
            return problem(p, spec.max);
          }
          return Response.json({ key, size: data.size });
        }

        return new Response("bad request", { status: 400 });
      },
    },
  },
});
