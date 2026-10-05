/**
 * Страница «Поделиться» (Р5): ссылки на магазин и бота, QR и отдельные
 * ссылки с меткой источника по каналам. Метки собирает тот же генератор, что
 * в аналитике (core/analytics/source-links): бот пишет `src_<метка>` в
 * state.first_source покупателя, витрина — `site:<метка>`, воронка по
 * источникам сводит их в одну строку `tag:<метка>` вместе с заказами и
 * выручкой этого покупателя. Новых полей в базе нет.
 */
import qrcode from "qrcode-generator";
import { botSourceLink, sourceTag, storeSourceLink } from "@/core/analytics/source-links";

/** Каналы с готовой меткой: продавцу не надо ничего придумывать. */
export const SHARE_CHANNELS = ["instagram", "whatsapp", "telegram", "tiktok"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export type ShareTargets = { bot: string | null; store: string | null };

export type ShareLinks = { bot: string | null; store: string | null };

/** Ссылки с меткой; метка не прошла разбор — null (такого канала нет). */
export function shareLinks(targets: ShareTargets, rawTag: string): ShareLinks | null {
  const tag = sourceTag(rawTag);
  if (!tag.ok) return null;
  return {
    bot: targets.bot ? botSourceLink(targets.bot, tag.tag) : null,
    store: targets.store ? storeSourceLink(targets.store, tag.tag) : null,
  };
}

/** Ссылки без метки: как есть. */
export function plainLinks(targets: ShareTargets): ShareLinks {
  return {
    bot: targets.bot ? `https://t.me/${targets.bot.replace(/^@/, "")}` : null,
    store: targets.store,
  };
}

/** Главная ссылка для текста: витрина, если она открыта, иначе бот. */
export function mainLink(links: ShareLinks): string | null {
  return links.store ?? links.bot;
}

/** QR со ссылкой в виде SVG: можно навести камеру с другого устройства или распечатать. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
