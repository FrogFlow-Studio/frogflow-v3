import type { CuratorSetting } from "@/core/tenant/types";

/**
 * Кураторы онлайн-школы: несколько проверяющих домашние задания. Работа
 * ученика уходит одному куратору — назначенному при первой сдаче и
 * закреплённому за учеником (core/courses/curators.server).
 */
export const CURATORS_MAX = 20;
export const CURATOR_COHORTS_MAX = 50;

export type CuratorMode = "rotate" | "cohort";
export type CuratorsConfig = { mode: CuratorMode; items: CuratorSetting[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Настройка из bots.settings: битые строки отбрасываются, дубли id и Telegram — тоже. */
export function parseCurators(raw: unknown): CuratorsConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as { mode?: unknown; items?: unknown };
  const seenId = new Set<string>();
  const seenTg = new Set<number>();
  const items: CuratorSetting[] = [];
  for (const x of Array.isArray(o.items) ? o.items : []) {
    const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id : "";
    const tg = c.telegram_id;
    if (!UUID.test(id) || seenId.has(id)) continue;
    if (typeof tg !== "number" || !Number.isSafeInteger(tg) || tg <= 0 || seenTg.has(tg)) continue;
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 60) : "";
    if (!name) continue;
    seenId.add(id);
    seenTg.add(tg);
    const username = typeof c.username === "string" ? c.username.trim().toLowerCase() : "";
    const cohorts = (Array.isArray(c.cohorts) ? c.cohorts : [])
      .filter((v): v is string => typeof v === "string" && UUID.test(v))
      .slice(0, CURATOR_COHORTS_MAX);
    items.push({
      id,
      name,
      telegram_id: tg,
      ...(username ? { username: username.slice(0, 40) } : {}),
      ...(cohorts.length ? { cohorts } : {}),
    });
    if (items.length >= CURATORS_MAX) break;
  }
  return { mode: o.mode === "cohort" ? "cohort" : "rotate", items };
}

/**
 * Кому из кураторов достаётся новый ученик. `turn` — порядковый номер
 * назначения (общий счётчик): по нему кураторы идут по кругу. В режиме
 * «по потокам» сначала те, кто ведёт поток ученика; нет таких — все.
 */
export function pickCurator(
  cfg: CuratorsConfig,
  cohortId: string | null | undefined,
  turn: number,
): CuratorSetting | null {
  if (cfg.items.length === 0) return null;
  const own =
    cfg.mode === "cohort" && cohortId ? cfg.items.filter((c) => c.cohorts?.includes(cohortId)) : [];
  const pool = own.length ? own : cfg.items;
  return pool[((turn % pool.length) + pool.length) % pool.length]!;
}
