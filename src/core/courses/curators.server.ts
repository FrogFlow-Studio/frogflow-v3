import type { CuratorSetting } from "@/core/tenant/types";
import { updateSettingAtomic } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { parseCurators, pickCurator } from "./curators";
import { readSetting, readSettings } from "./db.server";
import { parseRun, runKey } from "./run.server";

/**
 * Назначение куратора ученику. Закрепление — запись `course_cur_<позиция>`
 * с id куратора: первый, кто её поставил, выигрывает, повтор события или
 * два одновременных запроса получают того же куратора. Очередь — общий
 * счётчик `course_cur_turn`, растёт только условной записью.
 */
export const CURATOR_KEY_PREFIX = "course_cur_";
export const curatorKey = (orderItemId: string) => `${CURATOR_KEY_PREFIX}${orderItemId}`;
const TURN_KEY = "course_cur_turn";

const config = (ctx: TenantContext) => parseCurators(ctx.tenant.settings.curators);

export async function assignedCurator(
  ctx: TenantContext,
  orderItemId: string,
): Promise<CuratorSetting | null> {
  const id = await readSetting(ctx, curatorKey(orderItemId));
  return config(ctx).items.find((c) => c.id === id) ?? null;
}

/** Куратор ученика; нет назначенного (или его убрали из списка) — назначить заново. */
export async function ensureCurator(
  ctx: TenantContext,
  orderItemId: string,
): Promise<CuratorSetting | null> {
  const cfg = config(ctx);
  if (cfg.items.length === 0) return null;
  const known = new Set(cfg.items.map((c) => c.id));
  const current = await readSetting(ctx, curatorKey(orderItemId));
  if (current && known.has(current)) return cfg.items.find((c) => c.id === current)!;

  let turn = 0;
  const t = await updateSettingAtomic(ctx, TURN_KEY, (raw) => {
    turn = Number.parseInt(raw ?? "0", 10) || 0;
    return String(turn + 1);
  });
  if (t !== "written") return null;
  const run = parseRun(await readSetting(ctx, runKey(orderItemId)));
  const pick = pickCurator(cfg, run?.cohortId, turn);
  if (!pick) return null;
  let winner = pick.id;
  const r = await updateSettingAtomic(ctx, curatorKey(orderItemId), (raw) => {
    if (raw && known.has(raw)) {
      winner = raw;
      return null;
    }
    return pick.id;
  });
  if (r === "failed") return null;
  return cfg.items.find((c) => c.id === winner) ?? null;
}

/** Закреплённые кураторы по позициям — для очереди работ в админке. */
export async function curatorsOf(
  ctx: TenantContext,
  orderItemIds: readonly string[],
): Promise<Map<string, CuratorSetting>> {
  const byId = new Map(config(ctx).items.map((c) => [c.id, c]));
  const raw = await readSettings(ctx, orderItemIds.map(curatorKey));
  const out = new Map<string, CuratorSetting>();
  for (const id of orderItemIds) {
    const c = byId.get(raw.get(curatorKey(id)) ?? "");
    if (c) out.set(id, c);
  }
  return out;
}
