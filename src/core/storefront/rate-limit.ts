import { reportError } from "@/lib/errors";
import { updateSettingAtomic } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";

export type Budget = { limit: number; windowMs: number };

/**
 * Бюджеты Mini App на одного покупателя в одном магазине. Оформление шлёт
 * сообщение от бота и пишет корзину — ему строже; «Мои заказы» подписывают
 * ссылки на файлы. В v1 бюджеты тоже были раздельными (tests/mini-app-rate-limit).
 */
export const MINI_APP_BUDGETS = {
  checkout: { limit: 6, windowMs: 60_000 },
  orders: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, Budget>;

/**
 * Скользящее окно в памяти процесса. У каждого экземпляра функции свой счёт,
 * после холодного старта он пуст, поэтому это только первый рубеж: пачку
 * одного покупателя он режет без похода в базу. Общий счёт — takeShared.
 */
export function rateLimiter(maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  return {
    /** true — запрос пропускаем и засчитываем; false — лимит исчерпан, отказ не засчитывается. */
    take(key: string, b: Budget, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - b.windowMs);
      if (recent.length >= b.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      // Map помнит порядок вставки: переставляем ключ в конец, вытесняем самый давний.
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
      return true;
    },
    size: () => hits.size,
  };
}

/**
 * Общие счётчики в app_settings магазина: `rate_limit:<вид>:<кто>`. Таблицы
 * под лимиты нет, схему не меняем; префикс строгий — ночная уборка
 * (core/retention, pruneRateLimits) удаляет только такие строки.
 */
export const RATE_LIMIT_PREFIX = "rate_limit:";

export function rateLimitKey(kind: string, subject: string): string {
  return `${RATE_LIMIT_PREFIX}${kind}:${subject}`;
}

/** Счётчик окна: начало текущего окна, попытки в нём и в предыдущем. */
type Counter = { w: number; c: number; p: number };

export function parseCounter(raw: string | null | undefined): Counter | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Counter>;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
    return ok(v.w) && ok(v.c) && ok(v.p) ? { w: v.w, c: v.c, p: v.p } : null;
  } catch {
    return null;
  }
}

/**
 * Следующее значение счётчика или null, если лимит исчерпан (отказ не
 * засчитывается). Приближённое скользящее окно: попытки прошлого окна
 * считаются с весом той его доли, что ещё попадает в последние windowMs
 * (с округлением вверх: на стыке окон лимит не удваивается).
 * Хранится три числа, а не список меток — строка не растёт.
 */
export function nextCounter(raw: string | null, b: Budget, now: number): string | null {
  let w = Math.floor(now / b.windowMs) * b.windowMs;
  let c = 0;
  let p = 0;
  const old = parseCounter(raw);
  if (old) {
    if (old.w === w || old.w > w) {
      // То же окно, или часы другого экземпляра спешат: считаем в его окне.
      w = old.w;
      c = old.c;
      p = old.p;
    } else if (old.w === w - b.windowMs) p = old.c;
  }
  const weight = Math.min(1, Math.max(0, 1 - (now - w) / b.windowMs));
  if (Math.ceil(p * weight) + c >= b.limit) return null;
  return JSON.stringify({ w, c: c + 1, p });
}

const sharedLocal = rateLimiter();

/** На один ключ одного покупателя гонок почти нет: хватает нескольких кругов. */
const SHARED_TRIES = 8;

/**
 * Пропустить ли запрос: сначала счёт в памяти экземпляра, затем общий в базе
 * — его видят все экземпляры функции. Если база не ответила, решает счёт в
 * памяти: покупателя из-за сбоя не запираем, но и без лимита не остаёмся.
 */
export async function takeShared(
  ctx: TenantContext,
  kind: string,
  subject: string,
  b: Budget,
  local = sharedLocal,
  now = Date.now(),
  tries = SHARED_TRIES,
): Promise<boolean> {
  if (!local.take(`${ctx.tenant.id}:${kind}:${subject}`, b, now)) return false;
  let allowed = true;
  try {
    const r = await updateSettingAtomic(
      ctx,
      rateLimitKey(kind, subject),
      (raw) => {
        const next = nextCounter(raw, b, now);
        allowed = next != null;
        return next;
      },
      tries,
    );
    return r === "failed" ? true : allowed;
  } catch (e) {
    await reportError(e, { where: "rate-limit", botId: ctx.tenant.id, extra: { kind } });
    return true;
  }
}

/** Пропустить ли запрос покупателя `tgId` к части Mini App. */
export function takeMiniApp(
  ctx: TenantContext,
  tgId: number,
  kind: keyof typeof MINI_APP_BUDGETS,
): Promise<boolean> {
  return takeShared(ctx, `mini_app_${kind}`, `tg_${tgId}`, MINI_APP_BUDGETS[kind]);
}

/**
 * Страница курса: каждый показ подписывает файлы открытых уроков, отметка
 * урока пишет в базу. Счёт — на покупку (магазин + позиция заказа), только
 * по верной ссылке: чужую покупку без её подписи не выесть.
 */
export const COURSE_BUDGET: Budget = { limit: 30, windowMs: 60_000 };

export function takeCourse(ctx: TenantContext, itemId: string): Promise<boolean> {
  return takeShared(ctx, "course", itemId, COURSE_BUDGET);
}

/**
 * Файлы открытых уроков на странице курса: каждый переход подписывает файл.
 * Счёт — на товар (магазин + курс): открытый урок виден всем, поэтому лимит
 * общий для всех, кто его качает; обычный показ страницы подписей не делает.
 */
export const COURSE_FILE_BUDGET: Budget = { limit: 60, windowMs: 60_000 };

export function takeCourseFile(ctx: TenantContext, productId: string): Promise<boolean> {
  return takeShared(ctx, "course_file", productId, COURSE_FILE_BUDGET);
}
