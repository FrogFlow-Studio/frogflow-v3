/**
 * Чат админки, окно 24 часа (shop4-chat.spec.ts): диалог WhatsApp, где покупатель
 * писал двое суток назад, и диалог Telegram с таким же давним сообщением.
 */
import * as F from "../fixtures.ts";
import type { Row, StubDb } from "../pg-stub.ts";
import { add, addSettings, shop, shopBot } from "./util.ts";

export function seedShop4Chat(db: StubDb, now: string) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as Row), manager_chat: true };
  addSettings(db, now, [["whatsapp_bot_notify_template", F.CHAT_WA_TEMPLATE]]);

  const old = new Date(Date.parse(now) - 48 * 3_600_000).toISOString();
  const dialogs = [
    { id: F.CHAT_WA_ID, platform: "whatsapp", name: F.CHAT_WA_NAME, key: "whatsapp:e2e-chat" },
    { id: F.CHAT_TG_ID, platform: "telegram", name: F.CHAT_TG_NAME, key: "telegram:e2e-chat" },
    { id: F.CHAT_LONG_ID, platform: "telegram", name: F.CHAT_LONG_NAME, key: "telegram:e2e-long" },
  ];
  add(
    db,
    "bot_users",
    dialogs.map((d) =>
      shop({
        id: `e2e00000-0000-4000-8000-00000000c${Math.abs(d.id) % 1000}`,
        user_key: d.key,
        telegram_id: d.id,
        platform: d.platform,
        first_name: d.name,
      }),
    ),
  );
  add(
    db,
    "manager_chat_state",
    dialogs.map((d) =>
      shop({
        telegram_id: d.id,
        active: false,
        last_message_at: old,
        last_message_preview: "Здравствуйте, есть в наличии?",
        last_message_direction: "in",
        unread_count: 0,
      }),
    ),
  );
  seedShop4ChatLong(db, now);
  add(
    db,
    "manager_chat_messages",
    dialogs
      .filter((d) => d.id !== F.CHAT_LONG_ID)
      .map((d) =>
        shop({
          id: `e2e00000-0000-4000-8000-00000000d${Math.abs(d.id) % 1000}`,
          telegram_id: d.id,
          direction: "in",
          sender: "customer",
          text: "Здравствуйте, есть в наличии?",
          created_at: old,
        }),
      ),
  );
}

/** Постоянный покупатель: 230 сообщений в минуту друг от друга, самое раннее — с меткой. */
function seedShop4ChatLong(db: StubDb, now: string) {
  const start = Date.parse(now) - 3 * 24 * 3_600_000;
  add(
    db,
    "manager_chat_messages",
    Array.from({ length: F.CHAT_LONG_COUNT }, (_, i) =>
      shop({
        id: `e2e00000-0000-4000-8000-${String(900000000000 + i)}`,
        telegram_id: F.CHAT_LONG_ID,
        direction: "in",
        sender: "customer",
        text: i === 0 ? F.CHAT_LONG_FIRST : `Сообщение ${i}`,
        created_at: new Date(start + i * 60_000).toISOString(),
      }),
    ),
  );
}
