/**
 * Диалоги продавца, партия 16 (shop16-d-chat.spec.ts): 60 диалогов старше основных, чтобы
 * список не помещался на первую страницу. Клиент 1 — самый свежий.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, shop } from "./util.ts";

export function seedShop16DChat(db: StubDb, now: string) {
  const base = Date.parse(now) - 4 * 24 * 3_600_000;
  const ns = Array.from({ length: F.CHAT_MANY_COUNT }, (_, i) => i + 1);
  add(
    db,
    "bot_users",
    ns.map((n) =>
      shop({
        id: `e2e00000-0000-4000-8000-00000000e${String(n).padStart(3, "0")}`,
        user_key: `telegram:e2e-many-${n}`,
        telegram_id: F.chatManyId(n),
        platform: "telegram",
        first_name: F.chatManyName(n),
      }),
    ),
  );
  add(
    db,
    "manager_chat_state",
    ns.map((n) =>
      shop({
        telegram_id: F.chatManyId(n),
        active: false,
        last_message_at: new Date(base - n * 60_000).toISOString(),
        last_message_preview: `Вопрос ${n}`,
        last_message_direction: "in",
        unread_count: n % 2,
      }),
    ),
  );
}
