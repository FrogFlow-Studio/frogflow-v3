import { serviceDb } from "@/core/db/client.server";
import { signedFileUrl } from "@/core/orders/deliver-order";
import { cabinetFile, openCabinet } from "@/v4/cabinet/cabinet";
import { postgrestV4Db, type RpcClient, type V4Db } from "@/v4/core/db";

/**
 * Точки входа кабинета v4 (/c/<bot>/<token>). Ссылку создаёт только выдача v4
 * (src/v4/jobs/deliver.ts), поэтому у клиентов v3 ссылок нет и кабинет пуст.
 * Пока схема v4 не открыта в PostgREST, кабинет тоже пуст, а не падает.
 */

const SCHEMA_NOT_EXPOSED = /schema must be one of|PGRST106/i;
const svc = (): V4Db => postgrestV4Db(serviceDb() as unknown as RpcClient);

export async function loadCabinet(botId: string, token: string, db: V4Db = svc()) {
  try {
    return await openCabinet(db, botId, token);
  } catch (e) {
    if (e instanceof Error && SCHEMA_NOT_EXPOSED.test(e.message)) return null;
    throw e;
  }
}

/** Скачивание: 302 на подписанную ссылку на 5 минут; всё прочее — 404 без подробностей. */
export async function cabinetFileResponse(
  botId: string,
  token: string,
  fileId: string,
  db: V4Db = svc(),
  sign: typeof signedFileUrl = signedFileUrl,
): Promise<Response> {
  const notFound = () =>
    new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  let f: Awaited<ReturnType<typeof cabinetFile>>;
  try {
    f = await cabinetFile(db, botId, token, fileId);
  } catch (e) {
    if (e instanceof Error && SCHEMA_NOT_EXPOSED.test(e.message)) return notFound();
    throw e;
  }
  if (!f) return notFound();
  const url = await sign(f.storagePath, 300, f.fileName);
  if (!url) return notFound();
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
