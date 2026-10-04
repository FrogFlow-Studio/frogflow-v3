import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { getSettingsStrict, updateSettingStamped } from "@/core/settings/settings";
import { AUTO_PERIOD_MS } from "./stats";
import { toJson } from "@/core/json";

/**
 * Итоги подбора и допродажи за 30 дней: сколько покупателей прошли квиз и сколько раз
 * добавили товар из «С этим берут». Отметка каждого события — строка в zernio_logs
 * (`event_type = engage`), как у автосообщений (core/automsg/stats): своей таблицы нет,
 * схема заморожена. Строки подчищает ретеншен zernio_logs, окно итогов короче его срока.
 *
 * Покупатель сайта без входа анонимен: его нажатия не пишут строк в журнал, а прибавляют
 * счётчик за день в одной строке `app_settings` (`engage_web:<вид>:<день>`).
 *
 * Отметка — лучшее старание: действие покупателя уже случилось, сбой записи не должен его
 * ломать. Это счётчик действий, а не сообщение или награда, поэтому «один раз» тут не нужно:
 * повторное нажатие — ещё одно добавление в корзину.
 */
export const ENGAGE_EVENT_TYPE = "engage";
export const ENGAGE_KINDS = ["quiz_done", "upsell_add"] as const;
export type EngageKind = (typeof ENGAGE_KINDS)[number];

export type EngageStats = {
  /** Прошли квиз до конца (показан результат или «ничего не подошло»). */
  quizDone: number;
  /** Сколько разных покупателей (покупатель сайта без входа — одна сессия на отметку). */
  quizBuyers: number;
  /** Добавили товар в корзину кнопкой из «С этим берут». */
  upsellAdded: number;
  upsellBuyers: number;
};

export const emptyEngageStats = (): EngageStats => ({
  quizDone: 0,
  quizBuyers: 0,
  upsellAdded: 0,
  upsellBuyers: 0,
});

/** Событие покупателя бота: строка журнала. Покупатель сайта — recordWebEngage. */
export async function recordEngage(
  ctx: TenantContext,
  kind: EngageKind,
  telegramId: number,
  now = new Date(),
): Promise<void> {
  const payload = toJson({ kind, telegram_id: telegramId });
  // Случайный хвост: два нажатия в одну миллисекунду (или два анонима) — две строки, не одна.
  const tail = Math.random().toString(36).slice(2, 8);
  try {
    const { error } = await ctx.db.from("zernio_logs").insert({
      bot_id: ctx.tenant.id,
      event_id: `${ENGAGE_EVENT_TYPE}:${ctx.tenant.id}:${kind}:${telegramId}:${now.getTime()}:${tail}`,
      event_type: ENGAGE_EVENT_TYPE,
      status: "done",
      payload,
      created_at: now.toISOString(),
    });
    if (error) console.error(`[engage:${ctx.tenant.id}] ${kind}: ${error.message}`);
  } catch (e) {
    console.error(`[engage:${ctx.tenant.id}] ${kind}`, e);
  }
}

/**
 * Отметка покупателя сайта: он анонимен и его запросы открыты всем, поэтому на магазин —
 * общий потолок в час, а само событие — прибавка к счётчику дня, а не новая строка: даже
 * при потолке строк журнала не прибавляется. Лишнее сверх потолка в итоги не попадает.
 */
export const ENGAGE_WEB_BUDGET = { limit: 200, windowMs: 60 * 60_000 };

export const ENGAGE_WEB_PREFIX = "engage_web:";
/** Счётчики дней старше этого срока удаляются (окно итогов — 30 дней). */
const ENGAGE_WEB_KEEP_DAYS = 35;

const webDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const webKey = (kind: EngageKind, day: string) => `${ENGAGE_WEB_PREFIX}${kind}:${day}`;

export async function recordWebEngage(
  ctx: TenantContext,
  kind: EngageKind,
  now = new Date(),
): Promise<boolean> {
  const { takeShared } = await import("@/core/storefront/rate-limit");
  if (!(await takeShared(ctx, "engage_web", "shop", ENGAGE_WEB_BUDGET))) return false;
  try {
    let created = false;
    const w = await updateSettingStamped(ctx, webKey(kind, webDay(now.getTime())), (raw) => {
      created = raw == null;
      return String((Number.parseInt(raw ?? "0", 10) || 0) + 1);
    });
    if (w === "written" && created) await pruneWebEngage(ctx, kind, now);
    return w === "written";
  } catch (e) {
    console.error(`[engage:${ctx.tenant.id}] ${kind}`, e);
    return false;
  }
}

/** Раз в день на вид: счётчики старше срока уходят, ошибка чистки отметку не ломает. */
async function pruneWebEngage(ctx: TenantContext, kind: EngageKind, now: Date): Promise<void> {
  const edge = webKey(kind, webDay(now.getTime() - ENGAGE_WEB_KEEP_DAYS * 86_400_000));
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .like("key", `${ENGAGE_WEB_PREFIX}${kind}:%`)
    .lt("key", edge);
  if (error) console.error(`[engage:${ctx.tenant.id}] чистка счётчиков: ${error.message}`);
}

/** Сколько раз покупатели сайта сделали действие за окно итогов: сумма счётчиков дней. */
async function webEngageTotals(
  ctx: TenantContext,
  now: number,
): Promise<Record<EngageKind, number>> {
  const days = Array.from({ length: Math.ceil(AUTO_PERIOD_MS / 86_400_000) + 1 }, (_, i) =>
    webDay(now - i * 86_400_000),
  );
  const keys = ENGAGE_KINDS.flatMap((k) => days.map((d) => webKey(k, d)));
  const got = await getSettingsStrict(ctx, keys);
  const out: Record<EngageKind, number> = { quiz_done: 0, upsell_add: 0 };
  for (const k of ENGAGE_KINDS)
    for (const d of days) out[k] += Number.parseInt(got[webKey(k, d)] ?? "0", 10) || 0;
  return out;
}

type EngageRow = { payload: unknown };

/** Чистый подсчёт по строкам zernio_logs. */
export function foldEngage(rows: readonly EngageRow[]): EngageStats {
  const out = emptyEngageStats();
  const quiz = new Set<number>();
  const upsell = new Set<number>();
  for (const r of rows) {
    const p = (r.payload ?? {}) as { kind?: string; telegram_id?: number | null };
    const who = typeof p.telegram_id === "number" ? p.telegram_id : null;
    if (p.kind === "quiz_done") {
      out.quizDone++;
      if (who !== null) quiz.add(who);
    } else if (p.kind === "upsell_add") {
      out.upsellAdded++;
      if (who !== null) upsell.add(who);
    }
  }
  // Покупатели бота — по числу разных id; покупатели сайта в «разных» не считаются (их не различить).
  out.quizBuyers = quiz.size;
  out.upsellBuyers = upsell.size;
  return out;
}

/** Итоги за 30 дней: журнал постранично (порядок кончается id) плюс счётчики сайта. */
export async function engageStats(ctx: TenantContext, now = Date.now()): Promise<EngageStats> {
  const since = new Date(now - AUTO_PERIOD_MS).toISOString();
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .eq("bot_id", ctx.tenant.id)
        .eq("event_type", ENGAGE_EVENT_TYPE)
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "Подбор и допродажа: отметки",
  );
  const stats = foldEngage(rows);
  // Покупатели сайта — счётчики дней; «разных» среди них не различить, в «разных» не входят.
  const web = await webEngageTotals(ctx, now);
  stats.quizDone += web.quiz_done;
  stats.upsellAdded += web.upsell_add;
  return stats;
}
