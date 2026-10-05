/**
 * Фото товара по ссылке из файла импорта (Р1). Ссылку пишет продавец, поэтому
 * сервер ходит по ней осторожно: только https, адрес резолвится один раз и
 * проверяется на внутреннюю сеть (pinnedLookup — тот же, что у вебхука CRM),
 * редиректы не выполняются, тело ограничено по размеру, содержимое сверяется
 * с типом. Ответ 5xx или тайм-аут — «не скачалось»: повторяет продавец, вслепую
 * мы не ходим по ссылке второй раз.
 */
import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pinnedLookup, safeWebhookUrl } from "@/core/crm/webhook";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type PhotoResult = { ok: true; key: string } | { ok: false; reason: string };

/** GET по https с закреплённым адресом: тело не больше max, редиректы не выполняются. */
export async function getPinned(
  url: string,
  timeoutMs: number,
  max: number,
): Promise<
  { ok: true; status: number; type: string; bytes: Uint8Array } | { ok: false; reason: string }
> {
  if (!safeWebhookUrl(url))
    return { ok: false, reason: "адрес не https или ведёт во внутреннюю сеть" };
  const { request } = await import("node:https");
  return new Promise((done) => {
    const req = request(
      new URL(url),
      {
        method: "GET",
        headers: { accept: "image/*", "user-agent": "FrogFlow-import/1" },
        lookup: pinnedLookup() as never,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          return done({
            ok: false,
            reason:
              status >= 300 && status < 400
                ? "ссылка перенаправляет (редиректы не берём)"
                : `ответ ${status}`,
          });
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > max) {
          res.destroy();
          return done({ ok: false, reason: "файл слишком большой" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > max) {
            res.destroy();
            return done({ ok: false, reason: "файл слишком большой" });
          }
          chunks.push(c);
        });
        res.on("end", () =>
          done({
            ok: true,
            status,
            type: String(res.headers["content-type"] ?? "")
              .split(";")[0]!
              .trim()
              .toLowerCase(),
            bytes: new Uint8Array(Buffer.concat(chunks)),
          }),
        );
        res.on("error", (e) => done({ ok: false, reason: e.message }));
      },
    );
    req.on("error", (e) =>
      done({
        ok: false,
        reason:
          e.name === "TimeoutError" || (e as { code?: string }).code === "ABORT_ERR"
            ? "не дождались ответа"
            : e.message,
      }),
    );
    req.end();
  });
}

/** Скачать фото и положить в бакет товаров под префикс клиента. */
export async function storeImportPhoto(
  ctx: TenantContext,
  url: string,
  timeoutMs = 15_000,
): Promise<PhotoResult> {
  const got = await getPinned(url, timeoutMs, MAX_PHOTO_BYTES);
  if (!got.ok) return got;
  const ext = TYPES[got.type];
  if (!ext) return { ok: false, reason: "это не JPEG, PNG или WebP" };
  const { contentMatchesExt } = await import("@/core/storage/sniff");
  if (got.bytes.length === 0 || !contentMatchesExt(ext, got.bytes))
    return { ok: false, reason: "содержимое не похоже на картинку" };
  const { newUploadKey } = await import("@/core/storage/upload");
  const key = newUploadKey(ctx.tenant.id, randomBytes(12).toString("hex"), `import.${ext}`);
  const { serviceDb } = await import("@/core/db/client.server");
  const { error } = await serviceDb()
    .storage.from("product-images")
    .upload(key, got.bytes, { contentType: got.type, upsert: false });
  return error ? { ok: false, reason: "не удалось сохранить" } : { ok: true, key };
}
