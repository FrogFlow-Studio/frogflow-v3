import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { isMissingTable } from "@/core/community/not-ready";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { marketplaceState } from "./consent";
import {
  MARKET_EVENT_KINDS,
  MARKET_STATS,
  cleanQuery,
  dedupeKey,
  hourBucket,
  summarize,
  type MarketEventKind,
  type MarketStats,
} from "./analytics";

/**
 * Аналитика площадки (В20): счётчики без личных данных. Таблица общая (RLS без политик, см.
 * migrations/19-20), доступ через serviceDb. Таблицы может не быть: запись молчит, чтение
 * отвечает «нет данных», миграцию применяет Яков своим словом.
 */
const DAY = 86_400_000;

export type TrackInput = {
  kind: MarketEventKind;
  /** Для search и empty — запрос; для click — id магазина. */
  key?: string;
  /** Адрес и браузер читает вызывающий; здесь они только входят в хеш и не сохраняются. */
  ip: string;
  ua: string;
  secret: string;
  now?: number;
};

/** Записать событие; повтор того же человека за час не считается. true — событие учтено. */
export async function recordMarketEvent(input: TrackInput): Promise<{ counted: boolean }> {
  if (!MARKET_EVENT_KINDS.includes(input.kind)) return { counted: false };
  const now = input.now ?? Date.now();
  const key =
    input.kind === "visit"
      ? ""
      : input.kind === "click"
        ? (input.key ?? "")
        : cleanQuery(input.key);
  if (input.kind !== "visit" && !key) return { counted: false };
  if (input.kind === "click" && !/^[0-9a-f-]{36}$/i.test(key)) return { counted: false };
  const bucket = hourBucket(now);
  const dedupe = dedupeKey(input.secret, bucket, input.ip, input.ua);
  // Одно устройство за час — не больше DEVICE_CAP разных записей: случайными фразами счётчик не забить.
  const own = await serviceDb()
    .from("market_events")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .eq("dedupe", dedupe);
  if (own.error) {
    if (isMissingTable(own.error)) return { counted: false };
    throw serverFailure(`аналитика площадки, проверка устройства: ${own.error.message}`);
  }
  if ((own.count ?? 0) >= MARKET_STATS.deviceCap) return { counted: false };
  const { error } = await serviceDb()
    .from("market_events")
    .insert({ kind: input.kind, key, bucket, dedupe, created_at: new Date(now).toISOString() });
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message))
      return { counted: false };
    if (isMissingTable(error)) return { counted: false };
    throw serverFailure(`аналитика площадки, событие не записано: ${error.message}`);
  }
  // Старое убираем при записи (каждая шестнадцатая), отдельного крона не нужно; сбой не мешает счёту.
  if (dedupe.startsWith("0")) {
    await serviceDb()
      .from("market_events")
      .delete()
      .lt("created_at", new Date(now - MARKET_STATS.keepDays * DAY).toISOString());
  }
  return { counted: true };
}

async function readEvents(
  since: string,
  kinds: readonly MarketEventKind[],
  key?: string,
): Promise<{ kind: string; key: string }[] | null> {
  try {
    return await pageAll<{ id: string; kind: string; key: string }>((from, to) => {
      let q = serviceDb()
        .from("market_events")
        .select("id, kind, key")
        .in("kind", [...kinds])
        .gte("created_at", since);
      if (key !== undefined) q = q.eq("key", key);
      return q.order("id").range(from, to);
    }, "аналитика площадки, чтение событий");
  } catch (e) {
    if (
      e instanceof Error &&
      /could not find the table|does not exist|PGRST205|42P01/i.test(e.message)
    )
      return null;
    throw e;
  }
}

export type MarketOverview = Omit<MarketStats, "clicksByShop"> & {
  /** Магазины на площадке и сколько переходов у каждого; без трафика — count 0. */
  shops: { id: string; name: string; clicks: number }[];
  /** Переходы в магазины, которых сейчас на площадке нет (ушли или скрыты). */
  otherClicks: number;
};

/** Сводка для оператора за 30 дней; null — таблицы ещё нет. */
export async function marketOverview(now = Date.now()): Promise<MarketOverview | null> {
  const rows = await readEvents(
    new Date(now - MARKET_STATS.days * DAY).toISOString(),
    MARKET_EVENT_KINDS,
  );
  if (!rows) return null;
  const s = summarize(rows);
  const shown = (await tenantDirectory()).filter((t) => marketplaceState(t) === "visible");
  const ids = new Set(shown.map((t) => t.id));
  const shops = shown
    .map((t) => ({ id: t.id, name: t.name, clicks: s.clicksByShop.get(t.id) ?? 0 }))
    .sort(
      (a, b) => a.clicks - b.clicks || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  let other = 0;
  for (const [id, n] of s.clicksByShop) if (!ids.has(id)) other += n;
  const { clicksByShop: _drop, ...rest } = s;
  void _drop;
  return { ...rest, shops, otherClicks: other };
}

/** «Ваши переходы с площадки» за 30 дней; null — таблицы ещё нет. */
export async function shopMarketClicks(
  botId: string,
  now = Date.now(),
): Promise<{ days: number; clicks: number } | null> {
  const rows = await readEvents(
    new Date(now - MARKET_STATS.days * DAY).toISOString(),
    ["click"],
    botId,
  );
  return rows ? { days: MARKET_STATS.days, clicks: rows.length } : null;
}
