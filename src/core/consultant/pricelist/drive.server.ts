import { UserError } from "@/core/i18n/user-error";
import type { FetchLike } from "@/core/catalog/sheet.server";

/**
 * Прайс по ссылке Google Drive (перенос v1 consultant/drive.ts): разовая
 * загрузка открытого файла — выгрузки 1С в CSV или Excel. Без автообновления:
 * обновлять прайс по расписанию умеет Google Таблица (sheet.server).
 *
 * Только ссылка на файл. Папку v1 читал по HTML-странице и брал первый
 * попавшийся файл — не обязательно свежий; здесь папка — понятная ошибка.
 */
export const DRIVE_TIMEOUT_MS = 20_000;
export const DRIVE_MAX_BYTES = 8 * 1024 * 1024;

export function driveFileId(raw: string): string | null {
  const url = raw.trim();
  const file = /^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/.exec(url);
  if (file) return file[1]!;
  const param =
    /^https:\/\/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]{10,})/.exec(url);
  return param?.[1] ?? null;
}

const isFolder = (raw: string) =>
  /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//.test(raw.trim());

/** Куда Drive переадресует скачивание открытого файла. */
function allowedHop(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "drive.google.com" ||
      url.hostname === "drive.usercontent.google.com" ||
      url.hostname.endsWith(".googleusercontent.com"))
  );
}

async function readLimited(res: Response, max: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export type DriveFile = { kind: "xlsx"; data: Buffer } | { kind: "csv"; text: string };

/** Текст CSV: UTF-8, иначе Windows-1251 (выгрузки 1С), как при загрузке файла в админке. */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

const badLink = () =>
  new UserError(
    "err.pricelist.driveLink",
    "Нужна ссылка Google Drive на файл (drive.google.com/file/d/…), открытый всем, у кого есть ссылка.",
  );

/**
 * Скачать файл по ссылке. Переадресации проходим сами и только по адресам
 * Google; страница входа или HTML вместо файла — файл закрыт.
 */
export async function downloadDriveFile(
  link: string,
  fetchImpl: FetchLike = fetch,
): Promise<DriveFile> {
  if (isFolder(link))
    throw new UserError(
      "err.pricelist.driveFolder",
      "Это ссылка на папку. Откройте файл с прайсом в Drive и скопируйте ссылку на него.",
    );
  const id = driveFileId(link);
  if (!id) throw badLink();
  const closed = () =>
    new UserError(
      "err.pricelist.driveClosed",
      "Файл не скачался: откройте доступ «Все, у кого есть ссылка» и попробуйте ещё раз.",
    );
  let url = `https://drive.google.com/uc?export=download&id=${id}`;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
        headers: { "user-agent": "FrogFlowConsultant/1.0" },
      });
    } catch {
      throw closed();
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw closed();
      const next = new URL(loc, url);
      if (next.hostname === "accounts.google.com" || !allowedHop(next)) throw closed();
      url = next.toString();
      continue;
    }
    if (!res.ok) throw closed();
    const tooBig = () =>
      new UserError("err.pricelist.driveTooBig", "Файл больше {mb} МБ.", {
        mb: DRIVE_MAX_BYTES / 1024 / 1024,
      });
    if (Number(res.headers.get("content-length") ?? 0) > DRIVE_MAX_BYTES) throw tooBig();
    const body = await readLimited(res, DRIVE_MAX_BYTES).catch(() => {
      throw closed();
    });
    if (body === null) throw tooBig();
    // .xlsx — zip: начинается с «PK».
    if (body[0] === 0x50 && body[1] === 0x4b) return { kind: "xlsx", data: body };
    const text = decodeCsv(body);
    // Страница Google (вход, «нет доступа», проверка на вирусы) вместо файла.
    if (
      /^\s*<(!doctype|html)/i.test(text) ||
      /text\/html/i.test(res.headers.get("content-type") ?? "")
    )
      throw closed();
    return { kind: "csv", text };
  }
  throw closed();
}
