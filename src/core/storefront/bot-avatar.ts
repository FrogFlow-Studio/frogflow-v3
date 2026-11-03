/**
 * Аватар Telegram-бота магазина для шапки витрины и страниц заказов
 * (03.11.2026, Яков: «вместо зелёного кружка — аватар бота»). Фото бота
 * раз в сутки забирает часовой крон ensure-webhook
 * (channels/telegram/bot-avatar.server) и кладёт в Storage; здесь — только
 * запись в app_settings и её разбор. Нет фото — витрина рисует кружок с буквами.
 */
export const BOT_AVATAR_KEY = "bot_avatar";

/** Как часто сверять фото бота с Telegram. */
export const BOT_AVATAR_TTL_MS = 24 * 60 * 60 * 1000;

export type BotAvatar = {
  /** Ключ в Storage (`<bot_id>/brand/…`); null — у бота нет фото. */
  path: string | null;
  /** file_unique_id фото: не сменилось — не перекачиваем. */
  uid: string | null;
  checkedAt: string;
};

export function botAvatarPath(botId: string, uid: string): string {
  return `${botId}/brand/bot-avatar-${uid}.jpg`;
}

/** Запись из app_settings; битая или с чужим ключом — как будто её нет. */
export function parseBotAvatar(raw: string | null, botId: string): BotAvatar | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const checkedAt = typeof o.checkedAt === "string" ? o.checkedAt : null;
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) return null;
  const uid = typeof o.uid === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.uid) ? o.uid : null;
  const path = uid && o.path === botAvatarPath(botId, uid) ? o.path : null;
  return { path, uid: path ? uid : null, checkedAt };
}

/** Пора сверить фото: записи нет или ей больше суток. */
export function botAvatarStale(a: BotAvatar | null, now: number): boolean {
  return !a || now - Date.parse(a.checkedAt) >= BOT_AVATAR_TTL_MS;
}
