import { pageAll } from "@/core/db/page";
import { serviceDb } from "@/core/db/client.server";
import { MODULES, type ModuleKey } from "@/core/modules/registry";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  ADDON_KEYS,
  MONTHLY_PRICE,
  PLAN_TIERS,
  TIER_TITLES,
  parsePlan,
  type AddonKey,
  type PlanTier,
} from "@/core/plans/registry";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { serverFailure } from "@/lib/server-failure";
import { logEvent } from "./client-log.server";
import { setModule } from "./client-settings.server";
import { notifyOwner } from "./owner-messages.server";

/** Заявки продавцов на модули. */

/* ── заявки на модули ─────────────────────────────────────────────── */

export type ModuleRequestView = {
  id: string;
  botId: string;
  clientName: string;
  moduleKey: ModuleKey;
  moduleTitle: string;
  price: number | null;
  requestedAt: string;
  alreadyOn: boolean;
};

/**
 * Заявки на тариф из админки продавца лежат в той же очереди: `plan:<уровень>`
 * — переход на план, `addon:<канал>` — канал сверх плана. Схема не меняется,
 * module_key — свободный текст.
 */
function planRequest(key: string): {
  title: string;
  price: number | null;
  alreadyOn: (t: Tenant) => boolean;
  apply: (botId: string, actor: string) => Promise<void>;
} | null {
  const [kind, value] = key.split(":");
  if (kind === "plan" && (PLAN_TIERS as readonly string[]).includes(value ?? "")) {
    const tier = value as PlanTier;
    return {
      title: `Переход на план ${TIER_TITLES[tier]}`,
      price: MONTHLY_PRICE[tier],
      alreadyOn: (t) => {
        const p = parsePlan(t.plan);
        return p?.kind === "tier" && p.tier === tier;
      },
      apply: async (botId, actor) => {
        const { setPlan } = await import("./plans.server");
        const t = (await tenantDirectory(true)).find((x) => x.id === botId);
        await setPlan(
          botId,
          {
            tier,
            period: t?.settings.billing?.period ?? "month",
            addons: t?.settings.billing?.addons ?? [],
          },
          actor,
        );
      },
    };
  }
  if (kind === "addon" && (ADDON_KEYS as string[]).includes(value ?? "")) {
    const addon = value as AddonKey;
    return {
      title: `${ADDONS[addon].title} сверх плана`,
      price: ADDON_MONTHLY_PRICE[addon],
      alreadyOn: (t) => Boolean(t.settings.billing?.addons?.includes(addon)),
      apply: async (botId, actor) => {
        const { setPlan } = await import("./plans.server");
        const t = (await tenantDirectory(true)).find((x) => x.id === botId);
        const p = parsePlan(t?.plan);
        if (p?.kind !== "tier") throw new Error("У клиента нет плана — сначала выберите план.");
        const addons = [...new Set([...(t?.settings.billing?.addons ?? []), addon])];
        await setPlan(
          botId,
          { tier: p.tier, period: t?.settings.billing?.period ?? "month", addons },
          actor,
        );
      },
    };
  }
  return null;
}

/** Единая очередь «Заказать подключение» со всех клиентов, самая старая внизу. */
export async function listModuleRequests(): Promise<ModuleRequestView[]> {
  const data = await pageAll<{
    id: string;
    bot_id: string;
    module_key: string;
    requested_at: string;
  }>(
    (from, to) =>
      serviceDb()
        .from("module_requests")
        .select("id, bot_id, module_key, requested_at")
        .eq("status", "pending")
        .order("requested_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "Заявки на подключение",
  );
  if (!data.length) return [];
  const tenants = await tenantDirectory(true);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  return data
    .filter((r) => byId.has(r.bot_id))
    .map((r) => {
      const t = byId.get(r.bot_id)!;
      const key = r.module_key as ModuleKey;
      const def = MODULES[key];
      const plan = planRequest(r.module_key);
      return {
        id: r.id,
        botId: r.bot_id,
        clientName: t.name,
        moduleKey: key,
        moduleTitle: plan ? plan.title : (def?.title ?? r.module_key),
        price: plan ? plan.price : (def?.price ?? null),
        requestedAt: r.requested_at,
        alreadyOn: plan ? plan.alreadyOn(t) : Boolean(t.modules[key]),
      };
    });
}

export async function pendingModuleRequestCount(): Promise<number> {
  const { count, error: readErr3 } = await serviceDb()
    .from("module_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (readErr3)
    throw serverFailure(`[operator] заявки на модули не посчитаны: ${readErr3.message}`);
  return count ?? 0;
}

/**
 * Закрыть заявку: включить модуль (и сказать владельцу) или просто снять с
 * очереди. Владельца уведомляем лучшим старанием — без бота сообщение не уйдёт.
 */
export async function resolveModuleRequest(
  id: string,
  action: "enable" | "dismiss",
  actor = "operator",
): Promise<{ notified: boolean }> {
  const { data: req, error: reqErr } = await serviceDb()
    .from("module_requests")
    .select("id, bot_id, module_key, status")
    .eq("id", id)
    .maybeSingle();
  if (reqErr) throw serverFailure(`[operator] заявка не прочитана: ${reqErr.message}`);
  if (!req) throw new Error("Заявка не найдена.");
  if (req.status !== "pending") return { notified: false };
  const key = req.module_key as ModuleKey;
  const plan = planRequest(req.module_key);
  let notified = false;
  if (action === "enable" && plan) {
    await plan.apply(req.bot_id, actor);
    notified = await notifyOwner(req.bot_id, `✅ ${plan.title}: готово.`)
      .then((r) => r.delivered.length > 0)
      .catch(() => false);
  } else if (action === "enable") {
    await setModule(req.bot_id, key, true, actor);
    const title = MODULES[key]?.title ?? key;
    notified = await notifyOwner(req.bot_id, `✅ Модуль «${title}» подключён к вашему магазину.`)
      .then((r) => r.delivered.length > 0)
      .catch(() => false);
  }
  // CHECK на status допускает только pending/resolved — «снять» тоже resolved,
  // разница остаётся в журнале клиента.
  const { error: updError } = await serviceDb()
    .from("module_requests")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (updError) throw serverFailure(`Не удалось закрыть заявку: ${updError.message}`);
  await logEvent(req.bot_id, "meta", { module_request: key, action }, actor);
  return { notified };
}
