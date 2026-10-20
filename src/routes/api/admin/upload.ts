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

function problem(p: UploadProblem, max: number, message?: string) {
  return Response.json({ problem: p, mb: mb(max), ...(message ? { message } : {}) }, { status: STATUS[p] });
}

let productFilesLimitEnsured = false;

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
          const fileSize = Number(body.size);
          const p = uploadProblem(
            kind,
            fileSize,
            String(body.type ?? ""),
            String(body.name ?? ""),
          );
          if (p) return problem(p, spec.max);

          if (kind === "file" && !productFilesLimitEnsured) {
            try {
              const { data: bInfo } = await serviceDb().storage.getBucket("product-files");
              if (
                bInfo &&
                typeof bInfo.file_size_limit === "number" &&
                bInfo.file_size_limit < spec.max
              ) {
                const up = await serviceDb().storage.updateBucket("product-files", {
                  public: false,
                  fileSizeLimit: spec.max,
                });
                if (up.error) {
                  console.warn("[upload] product-files limit sync error:", up.error);
                  if (fileSize > bInfo.file_size_limit) {
                    return problem(
                      "too_big",
                      spec.max,
                      `Лимит хранилища Supabase (${Math.round(bInfo.file_size_limit / 1048576)} МБ) меньше размера файла. Увеличьте Global file size limit в панели Supabase (Storage -> Settings).`,
                    );
                  }
                } else {
                  productFilesLimitEnsured = true;
                }
              } else {
                productFilesLimitEnsured = true;
              }
            } catch (err) {
              console.warn("[upload] product-files limit check error:", err);
            }
          }

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
          const p = uploadProblem(kind, Number(data.size), String(data.contentType ?? ""), key);
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
