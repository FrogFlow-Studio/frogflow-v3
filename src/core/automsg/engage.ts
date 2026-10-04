import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import { AUTO_PERIOD_MS } from "./stats";

/**
 * Итоги подбора и допродажи за 30 дней: сколько покупателей прошли квиз и сколько раз
 * добавили товар из «С этим берут». Отметка каждого события — строка в zernio_logs
 * (`event_type = engage`), как у автосообщений (core/automsg/stats): своей таблицы нет,
 * схема заморожена. Строки подчищает ретеншен zernio_logs, окно итогов короче его срока.
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

/** Кто: id покупателя в боте, либо null — покупатель сайта, которого мы не знаем. */
export async function recordEngage(
  ctx: TenantContext,
  kind: EngageKind,
  telegramId: number | null,
  now = new Date(),
): Promise<void> {
  const payload = { kind, telegram_id: telegramId } as unknown as Json;
  // Случайный хвост: два нажатия в одну миллисекунду (или два анонима) — две строки, не одна.
  const tail = Math.random().toString(36).slice(2, 8);
  try {
    const { error } = await ctx.db.from("zernio_logs").insert({
      bot_id: ctx.tenant.id,
      event_id: `${ENGAGE_EVENT_TYPE}:${ctx.tenant.id}:${kind}:${telegramId ?? "web"}:${now.getTime()}:${tail}`,
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
 * общий потолок в час; лишнее в итоги не попадает (это счётчик, не учёт денег).
 */
export const ENGAGE_WEB_BUDGET = { limit: 600, windowMs: 60 * 60_000 };

export async function recordWebEngage(ctx: TenantContext, kind: EngageKind): Promise<boolean> {
  const { takeShared } = await import("@/core/storefront/rate-limit");
  if (!(await takeShared(ctx, "engage_web", "shop", ENGAGE_WEB_BUDGET))) return false;
  await recordEngage(ctx, kind, null);
  return true;
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

/** Итоги за 30 дней; чтение постранично, порядок кончается id. */
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
  return foldEngage(rows);
}
