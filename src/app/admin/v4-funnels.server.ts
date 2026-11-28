import type { TenantContext } from "@/core/tenant/resolve.server";
import { listFunnels } from "@/v4/channels/funnel";
import { v4DbOf } from "./v4-today.server";

/**
 * Список воронок магазина v4. Схема не открыта в API — «не подключена»,
 * не сбой. Холста здесь нет: имя, пуск и виды шагов.
 */

export type V4FunnelList =
  | { state: "not_connected" }
  | {
      state: "ready";
      funnels: { id: string; name: string; trigger: string; steps: string[] }[];
    };

const SCHEMA = /schema must be one of|PGRST106/i;

export async function loadV4Funnels(
  ctx: Pick<TenantContext, "db" | "tenant">,
): Promise<V4FunnelList> {
  try {
    const rows = await listFunnels(v4DbOf(ctx), ctx.tenant.id);
    return {
      state: "ready",
      funnels: rows.map((f) => ({
        id: f.id,
        name: f.name,
        trigger: f.triggerValue ? `${f.triggerKind}:${f.triggerValue}` : f.triggerKind,
        steps: f.steps.map((s) => s.kind),
      })),
    };
  } catch (e) {
    if (e instanceof Error && SCHEMA.test(e.message)) return { state: "not_connected" };
    throw e;
  }
}
