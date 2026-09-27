import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { setSetting } from "@/core/settings/settings";

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

export async function readSellerNote(ctx: TenantContext, userKey: string): Promise<SellerNote> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", `${NOTE_PREFIX}${userKey}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseSellerNote(data?.value);
}

/** Пустая заметка без тегов — строку удаляем, чтобы не копить пустые. */
export async function writeSellerNote(
  ctx: TenantContext,
  userKey: string,
  note: SellerNote,
): Promise<SellerNote> {
  const clean = cleanNote(note);
  const key = `${NOTE_PREFIX}${userKey}`;
  if (!clean.tags.length && !clean.note) {
    const { error } = await ctx.db.from("app_settings").delete().eq("key", key);
    if (error) throw new Error(error.message);
  } else await setSetting(ctx, key, JSON.stringify(clean));
  return clean;
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
