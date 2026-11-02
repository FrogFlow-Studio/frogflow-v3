import { sha256 } from "../core/access/access";
import type { V4Db } from "../core/db";

/**
 * Кабинет покупателя по ссылке (решение 12, migrations/v4/013): купленное и
 * файлы на языке покупателя. Ссылка — секрет: в базе только её sha256,
 * читает сервисная роль. Неверная или старая ссылка — пустой кабинет.
 */

export type CabinetLang = "ru" | "kk" | "en" | "uz";
export type CabinetEntry = {
  accessId: string;
  title: string;
  kind: "file" | "club";
  endsAt: Date | null;
  files: Array<{ id: string; name: string }>;
};
export type Cabinet = { lang: CabinetLang; entries: CabinetEntry[] } | null;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validCabinetParams = (botId: string, token: string) =>
  UUID_RE.test(botId) && TOKEN_RE.test(token);

export async function openCabinet(db: V4Db, botId: string, token: string): Promise<Cabinet> {
  if (!validCabinetParams(botId, token)) return null;
  const rows = await db.call("cabinet_files", { p_bot_id: botId, p_token_sha256: sha256(token) });
  if (!rows.length) return null;
  const lang = (["ru", "kk", "en", "uz"] as const).find((l) => l === rows[0]!.language) ?? "ru";
  const byAccess = new Map<string, CabinetEntry>();
  for (const r of rows) {
    const id = String(r.access_id);
    let e = byAccess.get(id);
    if (!e) {
      e = {
        accessId: id,
        title: String(r.title),
        kind: r.kind === "club" ? "club" : "file",
        endsAt: r.ends_at ? new Date(String(r.ends_at)) : null,
        files: [],
      };
      byAccess.set(id, e);
    }
    if (r.file_id) e.files.push({ id: String(r.file_id), name: String(r.file_name) });
  }
  return { lang, entries: [...byAccess.values()] };
}

/** Путь файла в хранилище, если ссылка жива и доступ к товару действует; иначе null. */
export async function cabinetFile(
  db: V4Db,
  botId: string,
  token: string,
  fileId: string,
): Promise<{ storagePath: string; fileName: string } | null> {
  if (!validCabinetParams(botId, token) || !UUID_RE.test(fileId)) return null;
  const r = (
    await db.call("cabinet_file", {
      p_bot_id: botId,
      p_token_sha256: sha256(token),
      p_file_id: fileId,
    })
  )[0];
  return r?.storage_path
    ? { storagePath: String(r.storage_path), fileName: String(r.file_name) }
    : null;
}

export const CABINET_TEXTS = {
  title: {
    ru: "Мои покупки",
    kk: "Менің сатып алғандарым",
    en: "My purchases",
    uz: "Mening xaridlarim",
  },
  invalid: {
    ru: "Ссылка устарела или неверна. Напишите продавцу — он пришлёт новую.",
    kk: "Сілтеме ескірген немесе қате. Сатушыға жазыңыз — ол жаңасын жібереді.",
    en: "This link has expired or is wrong. Message the seller and they'll send a new one.",
    uz: "Havola eskirgan yoki noto'g'ri. Sotuvchiga yozing — u yangisini yuboradi.",
  },
  until: {
    ru: "Доступ до",
    kk: "Қолжетімділік мерзімі",
    en: "Access until",
    uz: "Kirish muddati",
  },
  noFiles: {
    ru: "Файлов нет — продавец пришлёт материалы в переписке.",
    kk: "Файлдар жоқ — сатушы материалдарды хат алмасуда жібереді.",
    en: "No files here — the seller will send the materials in the chat.",
    uz: "Fayllar yo'q — sotuvchi materiallarni yozishmada yuboradi.",
  },
} satisfies Record<string, Record<CabinetLang, string>>;
