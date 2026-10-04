import type { TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer } from "@/core/customers/customers";
import { serverFailure } from "@/lib/server-failure";
import { ENTRY_EVENT, entryPrefix } from "./entry";
import { getGiveaway, type GiveawayStatus } from "./giveaway";

/**
 * Публичная страница итогов розыгрыша: условия, число участников, победители
 * со скрытыми именами, зерно и хеш для проверки. Имена и ключи покупателей
 * наружу не уходят — только маска `Ай***`.
 */
export type PublicGiveaway = {
  id: string;
  title: string;
  prize: string;
  conditions: string;
  endsAt: string;
  status: GiveawayStatus;
  /** Сколько человек участвует (все записанные участники). */
  entered: number;
  winnersCount: number;
  /** Только у выбранного розыгрыша. */
  result: null | {
    drawnAt: string;
    seed: string;
    listHash: string;
    eligible: number;
    winners: string[];
  };
};

/** Первые две буквы имени и «***»; пустое имя — только «***». */
export function maskName(name: string | null | undefined): string {
  const chars = Array.from((name ?? "").trim().replace(/^@/, ""));
  return `${chars.slice(0, 2).join("")}***`;
}

async function countEntries(ctx: TenantContext, id: string): Promise<number> {
  const { count, error } = await ctx.db
    .from("zernio_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", ENTRY_EVENT)
    .like("event_id", `${entryPrefix(id)}%`);
  if (error) throw serverFailure(`Розыгрыш: участники не посчитаны: ${error.message}`);
  return count ?? 0;
}

/** null — розыгрыша нет. Сбой чтения — serverFailure. */
export async function publicGiveaway(
  ctx: TenantContext,
  id: string,
): Promise<PublicGiveaway | null> {
  const g = await getGiveaway(ctx, id);
  if (!g) return null;
  const entered = await countEntries(ctx, g.id);
  let result: PublicGiveaway["result"] = null;
  if (g.status === "drawn" && g.result) {
    const names: string[] = [];
    for (const w of g.result.winners) {
      const c = await getCustomer(ctx, w.userKey);
      names.push(maskName(c?.firstName ?? c?.username));
    }
    result = {
      drawnAt: g.result.drawnAt,
      seed: g.result.seed,
      listHash: g.result.listHash,
      eligible: g.result.eligible,
      winners: names,
    };
  }
  return {
    id: g.id,
    title: g.title,
    prize: g.prize,
    conditions: g.conditions,
    endsAt: g.endsAt,
    status: g.status,
    entered,
    winnersCount: g.winners,
    result,
  };
}
