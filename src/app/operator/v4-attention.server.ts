import { serviceDb } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { postgrestV4Db, type RpcClient, type V4Db } from "@/v4/core/db";
import { attention, type AttentionScreen } from "@/v4/screens/screens";

/**
 * «Внимание (v4)» оператора: дела оператора по всем магазинам схемы v4 и
 * светофор магазинов (v4.attention, только сервисная роль). Схема v4 не
 * открыта в PostgREST (PGRST106) — «не подключена», а не сбой; любая
 * другая ошибка — сбой. Имена магазинов — из справочника арендаторов.
 */

export type V4AttentionView =
  | { state: "not_connected" }
  | { state: "ready"; screen: AttentionScreen; names: Record<string, string> };

const SCHEMA_NOT_EXPOSED = /schema must be one of|PGRST106/i;

export async function loadV4Attention(
  db: V4Db = postgrestV4Db(serviceDb() as unknown as RpcClient),
  names: () => Promise<Array<{ id: string; name: string }>> = tenantDirectory,
): Promise<V4AttentionView> {
  let screen: AttentionScreen;
  try {
    screen = await attention(db);
  } catch (e) {
    if (e instanceof Error && SCHEMA_NOT_EXPOSED.test(e.message)) return { state: "not_connected" };
    throw e;
  }
  const ids = new Set([...screen.shops.map((s) => s.botId), ...screen.cases.map((c) => c.botId)]);
  const byId: Record<string, string> = {};
  if (ids.size) for (const t of await names()) if (ids.has(t.id)) byId[t.id] = t.name;
  return { state: "ready", screen, names: byId };
}
