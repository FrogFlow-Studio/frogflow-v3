import {
  invalidateTenantDirectory,
  patchTenantSettings,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { logEvent } from "./client-log.server";

/** Группы магазинов. */

/* ── «Несколько ботов»: магазины одного продавца (core/tenant/shop-group) ── */

export type ShopGroupView = {
  group: string | null;
  members: { id: string; name: string }[];
  candidates: { id: string; name: string }[];
};

export async function shopGroupView(botId: string): Promise<ShopGroupView> {
  const { shopGroup } = await import("@/core/tenant/shop-group");
  const dir = await tenantDirectory(true);
  const self = dir.find((t) => t.id === botId);
  if (!self) throw new Error("Клиент не найден.");
  const g = shopGroup(self);
  const brief = (t: Tenant) => ({ id: t.id, name: t.name });
  const byName = (a: Tenant, b: Tenant) => a.name.localeCompare(b.name, "ru");
  return {
    group: g,
    members: g
      ? dir
          .filter((t) => shopGroup(t) === g)
          .sort(byName)
          .map(brief)
      : [],
    // Магазин из чужой группы связать нельзя (planLink), поэтому не предлагаем.
    candidates: dir
      .filter((t) => t.id !== botId && (!g || !shopGroup(t)))
      .sort(byName)
      .map(brief),
  };
}

async function applyGroupChanges(
  changes: { botId: string; group: string | null }[],
  actor: string,
) {
  for (const c of changes) {
    const value = c.group ? { group: c.group } : null;
    await patchTenantSettings(c.botId, { multi_bot: value });
    await logEvent(c.botId, "meta", { multi_bot: value }, actor);
  }
  invalidateTenantDirectory();
}

export async function linkShops(botId: string, otherId: string, actor = "operator") {
  const { planLink } = await import("@/core/tenant/shop-group");
  const dir = await tenantDirectory(true);
  const a = dir.find((t) => t.id === botId);
  const b = dir.find((t) => t.id === otherId);
  if (!a || !b) throw new Error("Клиент не найден.");
  // Группа — только отсюда и только свежий uuid: не угадать и не совпасть с чужой.
  const plan = planLink(a, b, crypto.randomUUID());
  if ("error" in plan) throw new Error(plan.error);
  await applyGroupChanges(plan.changes, actor);
}

export async function unlinkShop(botId: string, actor = "operator") {
  const { planUnlink } = await import("@/core/tenant/shop-group");
  const dir = await tenantDirectory(true);
  const t = dir.find((x) => x.id === botId);
  if (!t) throw new Error("Клиент не найден.");
  await applyGroupChanges(planUnlink(dir, t), actor);
}
