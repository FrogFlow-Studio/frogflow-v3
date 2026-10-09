import { importPricelistFn, pricelistFn } from "../pricelist.functions";
import { type AdminT } from "@/app/i18n/admin";

/** Общие типы и чтение файлов прайса. */

/** Выгрузка 1С бывает в UTF-8 и в Windows-1251: сначала строгий UTF-8, иначе 1251. */
export async function readCsv(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

export type Data = Awaited<ReturnType<typeof pricelistFn>>;

export type CardProps = { t: AdminT; data: Data; canEdit: boolean; onDone: () => Promise<void> };

/** Файл в base64 без префикса data: (Excel уходит на сервер байтами, без разбора в браузере). */
export async function rawBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export type ImportResult = Awaited<ReturnType<typeof importPricelistFn>>;

/** Что подтвердить: тот же файл или та же ссылка Drive, но уже с confirm. */
export type Pending = { kind: "file"; file: File } | { kind: "drive"; url: string };
