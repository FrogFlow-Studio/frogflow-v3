import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";

/**
 * Теги и заметка продавца о покупателе — строка app_settings
 * `customer_note:<user_key>`, по одной на покупателя (как заявки воронки).
 * Не в bot_users.metadata: каналы (upsertCustomer на каждом входящем
 * Instagram/WhatsApp) переписывают metadata целиком, и заметка молча
 * пропадала бы. Эту строку пишет только продавец из карточки.
 */
export const NOTE_PREFIX = "customer_note:";
export const MAX_TAGS = 20;
export const MAX_TAG_LEN = 32;
export const MAX_NOTE_LEN = 2000;

export type SellerNote = { tags: string[]; note: string };

/** Теги: без пробелов по краям, без повторов (без учёта регистра), не больше 20 по 32 символа. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function cleanNote(n: Partial<SellerNote> | null | undefined): SellerNote {
  return {
    tags: cleanTags(n?.tags),
    note: typeof n?.note === "string" ? n.note.trim().slice(0, MAX_NOTE_LEN) : "",
  };
}

export function parseSellerNote(raw: string | null | undefined): SellerNote {
  if (!raw) return cleanNote(null);
  try {
    return cleanNote(JSON.parse(raw) as Partial<SellerNote>);
  } catch {
    return cleanNote(null);
  }
}

export type VersionedNote = { note: SellerNote; version: string | null };
/** Итог записи: saved — записали; иначе кто-то успел раньше, `note` и `version` — актуальные. */
export type NoteResult = VersionedNote & { saved: boolean };

async function readVersioned(ctx: TenantContext, userKey: string): Promise<VersionedNote> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", `${NOTE_PREFIX}${userKey}`)
    .maybeSingle();
  if (error) throw serverFailure(`Заметка покупателя: ${error.message}`);
  return { note: parseSellerNote(data?.value), version: data?.updated_at ?? null };
}

export async function readSellerNote(ctx: TenantContext, userKey: string): Promise<SellerNote> {
  return (await readVersioned(ctx, userKey)).note;
}

/** Заметка вместе с версией (`updated_at` строки; null — строки нет): её возвращает форма при сохранении. */
export const readSellerNoteVersioned = readVersioned;

/**
 * Записать заметку, только если её версия всё ещё `expected` (то, что форма
 * получила при чтении): карточка и диалог пишут одной функцией, и один не
 * затирает другого. Условие — на маленькое поле `updated_at`, не на текст.
 * Версия меняется при каждой записи (не меньше чем на 1 мс). Не совпала —
 * ничего не пишем, возвращаем актуальную заметку. Пустая заметка без тегов
 * удаляет строку.
 */
export async function writeSellerNoteIf(
  ctx: TenantContext,
  userKey: string,
  note: SellerNote,
  expected: string | null,
): Promise<NoteResult> {
  const clean = cleanNote(note);
  const key = `${NOTE_PREFIX}${userKey}`;
  const conflict = async (): Promise<NoteResult> => ({
    saved: false,
    ...(await readVersioned(ctx, userKey)),
  });
  const empty = !clean.tags.length && !clean.note;
  if (expected === null) {
    if (empty) {
      const cur = await readVersioned(ctx, userKey);
      return cur.version === null
        ? { saved: true, note: clean, version: null }
        : { ...cur, saved: false };
    }
    const version = new Date().toISOString();
    const { error } = await ctx.db
      .from("app_settings")
      .insert({ bot_id: ctx.tenant.id, key, value: JSON.stringify(clean), updated_at: version });
    if (error?.code === "23505") return conflict();
    if (error) throw serverFailure(`Заметка покупателя: ${error.message}`);
    return { saved: true, note: clean, version };
  }
  if (empty) {
    const { data, error } = await ctx.db
      .from("app_settings")
      .delete()
      .eq("key", key)
      .eq("updated_at", expected)
      .select("key");
    if (error) throw serverFailure(`Заметка покупателя: ${error.message}`);
    return data?.length ? { saved: true, note: clean, version: null } : conflict();
  }
  const version = new Date(
    Math.max(Date.now(), Date.parse(expected) + 1) || Date.now(),
  ).toISOString();
  const { data, error } = await ctx.db
    .from("app_settings")
    .update({ value: JSON.stringify(clean), updated_at: version })
    .eq("key", key)
    .eq("updated_at", expected)
    .select("key");
  if (error) throw serverFailure(`Заметка покупателя: ${error.message}`);
  return data?.length ? { saved: true, note: clean, version } : conflict();
}

/** Все заметки магазина: user_key → заметка. Постранично. */
export async function allSellerNotes(ctx: TenantContext): Promise<Map<string, SellerNote>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${NOTE_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Заметки о покупателях не прочитались",
  );
  const out = new Map<string, SellerNote>();
  for (const r of rows)
    if (r.key.startsWith(NOTE_PREFIX))
      out.set(r.key.slice(NOTE_PREFIX.length), parseSellerNote(r.value));
  return out;
}
