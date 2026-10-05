import { randomBytes } from "node:crypto";

/**
 * Сохранённые адреса вошедшего покупателя (К5). Лежат в его карточке в магазине
 * (`bot_users.state.web_addr.items`), без новой таблицы. Читает и пишет только вошедший
 * подписанной сессией; почта ничего не открывает.
 */
export const ADDRESSES_MAX = 5;
export const ADDRESS_MAX_CHARS = 500;

export type SavedAddress = { id: string; text: string };

/** Чистый адрес: пробелы схлопнуты; пустой или длиннее предела — null (не режем молча). */
export function cleanAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return text && text.length <= ADDRESS_MAX_CHARS ? text : null;
}

const ID_RE = /^[0-9a-f]{12}$/;
export const newAddressId = () => randomBytes(6).toString("hex");
export const validAddressId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);

/** Список из состояния: мусор и повторы id отбрасываются, не больше ADDRESSES_MAX. */
export function parseAddresses(raw: unknown): SavedAddress[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedAddress[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = r as { id?: unknown; text?: unknown };
    const text = cleanAddress(o?.text);
    if (!validAddressId(o?.id) || !text || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, text });
    if (out.length >= ADDRESSES_MAX) break;
  }
  return out;
}

export type AddressChange =
  | { ok: true; items: SavedAddress[] | null } // null — менять нечего
  | { ok: false; reason: "full" | "unknown" | "bad_text" };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Добавить: тот же адрес второй раз не появляется (поднимается наверх), больше предела — «full». */
export function addAddress(items: readonly SavedAddress[], rawText: unknown): AddressChange {
  const text = cleanAddress(rawText);
  if (!text) return { ok: false, reason: "bad_text" };
  const at = items.findIndex((i) => same(i.text, text));
  if (at === 0) return { ok: true, items: null };
  if (at > 0) {
    const found = items[at]!;
    return { ok: true, items: [found, ...items.filter((_, i) => i !== at)] };
  }
  if (items.length >= ADDRESSES_MAX) return { ok: false, reason: "full" };
  return { ok: true, items: [{ id: newAddressId(), text }, ...items] };
}

/** Изменить текст адреса по id. */
export function editAddress(
  items: readonly SavedAddress[],
  id: unknown,
  rawText: unknown,
): AddressChange {
  const text = cleanAddress(rawText);
  if (!text) return { ok: false, reason: "bad_text" };
  const at = items.findIndex((i) => i.id === id);
  if (at < 0) return { ok: false, reason: "unknown" };
  if (items[at]!.text === text) return { ok: true, items: null };
  // Совпал с другим сохранённым — не плодим повтор, оставляем один.
  const dup = items.findIndex((i, k) => k !== at && same(i.text, text));
  if (dup >= 0) return { ok: true, items: items.filter((_, k) => k !== at) };
  return { ok: true, items: items.map((i, k) => (k === at ? { ...i, text } : i)) };
}

/** Удалить по id; нет такого — «unknown». */
export function removeAddress(items: readonly SavedAddress[], id: unknown): AddressChange {
  if (!items.some((i) => i.id === id)) return { ok: false, reason: "unknown" };
  return { ok: true, items: items.filter((i) => i.id !== id) };
}
