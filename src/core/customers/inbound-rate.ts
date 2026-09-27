import type { TenantContext } from "@/core/tenant/resolve.server";
import { takeShared, type Budget } from "@/core/storefront/rate-limit";

/**
 * Лимит частоты входящих от одного покупателя (Direct, WhatsApp, Telegram).
 * Проверка на приёме, до обработки: иначе один спамер или зациклившийся
 * автоответчик выбирает общий на магазин лимит ИИ-консультанта
 * (core/consultant/rate.server) за всех. Счёт общий для всех копий функции
 * (takeShared, строки rate_limit: чистит ночная уборка). Порог с запасом:
 * альбом из 10 фото чеков проходит целиком.
 */
export const INBOUND_BUDGET: Budget = { limit: 30, windowMs: 60_000 };
/** Продавцу — не больше одного уведомления о частых сообщениях на покупателя в час. */
export const FLOOD_NOTICE_BUDGET: Budget = { limit: 1, windowMs: 60 * 60_000 };

export type InboundVerdict = "ok" | "limited" | "limited_notify";

/**
 * Попыток условной записи счётчика меньше, чем у Mini App: вебхук Zernio
 * ждёт ответа 5 секунд, а пачка фото от одного покупателя идёт
 * параллельными вебхуками. Не выиграли гонку — пропускаем (решает счёт в
 * памяти экземпляра), а не держим ответ.
 */
const INBOUND_TRIES = 3;

/**
 * Пропустить ли входящее. `subject` — покупатель в канале (`tg_<id>`,
 * `instagram_<id>`). `exempt` зовётся, только когда лимит исчерпан: продавец
 * в своём боте лимиту не подчиняется, а лишнего чтения на каждое сообщение нет.
 */
export async function admitInbound(
  ctx: TenantContext,
  subject: string,
  exempt?: () => Promise<boolean>,
): Promise<InboundVerdict> {
  if (
    await takeShared(ctx, "inbound", subject, INBOUND_BUDGET, undefined, undefined, INBOUND_TRIES)
  )
    return "ok";
  if (exempt && (await exempt())) return "ok";
  return (await takeShared(
    ctx,
    "inbound_notice",
    subject,
    FLOOD_NOTICE_BUDGET,
    undefined,
    undefined,
    INBOUND_TRIES,
  ))
    ? "limited_notify"
    : "limited";
}

/** Текст уведомления продавцу (HTML; имя экранирует вызывающий). */
export function floodNoticeHtml(channel: string, who: string): string {
  return `⚠️ <b>Покупатель пишет слишком часто</b>\n${channel} · 👤 ${who}\n\nБольше ${INBOUND_BUDGET.limit} сообщений в минуту — лишние не обрабатываются, бот и консультант на них не отвечают. Если это человек, ответьте ему сами в «Чате».`;
}
