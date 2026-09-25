import type { Tenant, ZernioAccountSnapshot } from "./types";

/**
 * Кому принадлежит аккаунт Zernio — чистые правила без базы. Ключ и вебхук
 * Zernio одни на платформу, клиенты различаются профилем: событие уходит
 * тому арендатору, у кого accountId записан в settings.zernio.account_ids.
 * Один и тот же аккаунт у двух клиентов означал бы, что события уйдут
 * не туда, поэтому такая запись запрещена при сохранении, а справочник на
 * неоднозначный аккаунт отвечает «ничей».
 */
export function zernioAccountOwners(directory: readonly Tenant[], accountId: string): Tenant[] {
  const id = accountId.trim().toLowerCase();
  if (!id) return [];
  return directory.filter(
    (t) => !t.archived && t.settings.zernio?.account_ids?.some((a) => a.toLowerCase() === id),
  );
}

export type ForeignAccount = { id: string; owner: Tenant };

/** Аккаунты из списка, которые уже числятся у другого клиента. */
export function foreignZernioAccounts(
  directory: readonly Tenant[],
  botId: string,
  accountIds: readonly string[],
): ForeignAccount[] {
  const out: ForeignAccount[] = [];
  for (const id of accountIds) {
    const owner = zernioAccountOwners(directory, id).find((t) => t.id !== botId);
    if (owner) out.push({ id, owner });
  }
  return out;
}

export type SnapshotDiff = {
  added: ZernioAccountSnapshot[];
  removed: ZernioAccountSnapshot[];
  /** Были живы, стали отключёнными — продавца надо предупредить. */
  expired: ZernioAccountSnapshot[];
  restored: ZernioAccountSnapshot[];
};

export function diffZernioSnapshots(
  prev: readonly ZernioAccountSnapshot[],
  next: readonly ZernioAccountSnapshot[],
): SnapshotDiff {
  const before = new Map(prev.map((a) => [a.id, a]));
  const after = new Map(next.map((a) => [a.id, a]));
  const diff: SnapshotDiff = { added: [], removed: [], expired: [], restored: [] };
  for (const a of next) {
    const was = before.get(a.id);
    if (!was) diff.added.push(a);
    else if (!was.expired && a.expired) diff.expired.push(a);
    else if (was.expired && !a.expired) diff.restored.push(a);
  }
  for (const a of prev) if (!after.has(a.id)) diff.removed.push(a);
  return diff;
}
