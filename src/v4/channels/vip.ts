import type { TelegramApi } from "@/channels/telegram/api";
import { vipGroupMemberCount } from "@/channels/telegram/vip/group";
import type { V4Db } from "../core/db";
import { noteVipCount } from "../core/platform";

/**
 * Счётчик людей в VIP-группе из v3 (#230) для схемы v4.
 * Telegram не ответил — в базу не пишем ноль: страница покажет прошлое значение.
 */
export async function refreshVipCount(
  db: V4Db,
  api: TelegramApi,
  input: { botId: string; chatId: string },
): Promise<number | null> {
  const count = await vipGroupMemberCount(api, input.chatId);
  if (count == null) return null;
  const saved = await noteVipCount(db, { botId: input.botId, chatId: input.chatId, count });
  if (!saved.ok) return null;
  return saved.value;
}
