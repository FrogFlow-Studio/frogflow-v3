import { eachPage } from "@/core/db/page";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { PROFILE_KEY } from "./client-list.server";

/** События клиента и платформы, последние события Zernio. */

/**
 * Когда аккаунт последний раз присылал событие: по журналу zernio_logs,
 * ключ — accountId из payload, «*» — любое событие клиента. Оператор по
 * этому видит, что вебхук доходит именно до этого клиента. Под PROFILE_KEY —
 * профиль из последнего события: его записывают клиенту v1 перед переездом.
 */
export async function zernioLastEvents(
  botId: string,
  wantIds: string[] = [],
): Promise<Map<string, string>> {
  // Только события вебхука Zernio (`event_type` — имя события, как в HANDLED_EVENTS): отметки
  // автосообщений, учёта диалогов, обращений и склада пишутся в ту же таблицу, тоже свежие, и
  // иначе выдали бы «последнее событие: 10 минут назад» при сломанном вебхуке.
  const { HANDLED_EVENTS } = await import("@/channels/zernio/dispatch.server");
  const out = new Map<string, string>();
  // Читаем от свежих к старым постранично, пока не найдены «*» и все wantIds: аккаунт, молчавший
  // дольше последних N событий, иначе выглядел бы «событий не было» при живом вебхуке.
  const done = () => out.has("*") && wantIds.every((id) => out.has(id));
  await eachPage(
    (from, to) =>
      serviceDb()
        .from("zernio_logs")
        .select("payload, created_at")
        .eq("bot_id", botId)
        .in("event_type", [...HANDLED_EVENTS])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "[operator] журнал вебхуков",
    (rows) => {
      for (const row of rows) {
        if (!out.has("*")) out.set("*", row.created_at);
        const p = row.payload as {
          account?: { accountId?: string; id?: string; _id?: string; profileId?: string };
        } | null;
        const id = p?.account?.accountId || p?.account?.id || p?.account?._id;
        if (id && !out.has(id)) out.set(id, row.created_at);
        const profile = p?.account?.profileId;
        if (typeof profile === "string" && profile && !out.has(PROFILE_KEY))
          out.set(PROFILE_KEY, profile);
      }
      return !done();
    },
  );
  return out;
}

export type EventView = { id: string; at: string; actor: string; kind: string; payload: Json };

export async function listEvents(botId: string, limit = 40): Promise<EventView[]> {
  const { data, error: readErr6 } = await serviceDb()
    .from("bot_events")
    .select("id, at, actor, kind, payload")
    .eq("bot_id", botId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (readErr6) throw serverFailure(`[operator] события клиента не прочитаны: ${readErr6.message}`);
  return data ?? [];
}

export type PlatformEvent = EventView & { botId: string; botName: string };

/** Журнал действий оператора по всем клиентам: кто, что, у кого. */
export async function listAllEvents(
  opts: {
    limit?: number;
    botId?: string | null;
    kind?: string | null;
    /** shop — действия команды магазина (core/audit/admin-audit), platform — все прочие. */
    who?: "shop" | "platform" | null;
  } = {},
): Promise<PlatformEvent[]> {
  let q = serviceDb()
    .from("bot_events")
    .select("id, at, actor, kind, payload, bot_id")
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.botId) q = q.eq("bot_id", opts.botId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.who === "shop") q = q.like("actor", "admin:%");
  if (opts.who === "platform") q = q.not("actor", "like", "admin:%");
  const { data, error: readErr5 } = await q;
  if (readErr5) throw serverFailure(`[operator] журнал действий не прочитан: ${readErr5.message}`);
  const names = new Map((await tenantDirectory()).map((t) => [t.id, t.name]));
  return (data ?? []).map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor,
    kind: r.kind,
    payload: r.payload,
    botId: r.bot_id,
    botName: names.get(r.bot_id) ?? r.bot_id.slice(0, 8),
  }));
}
