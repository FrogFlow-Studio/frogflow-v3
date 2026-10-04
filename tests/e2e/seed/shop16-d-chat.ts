/**
 * Диалоги продавца, партия 16 (shop16-d-chat.spec.ts): 60 диалогов старше основных, чтобы
 * список не помещался на первую страницу. Клиент 1 — самый свежий.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, shop } from "./util.ts";

export function seedShop16DChat(db: StubDb, now: string) {
  seedPanelBuyer(db, now);
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

/** Покупатель с баллами и двумя заказами: в панели видны оба, в сумме покупок — только оплаченный. */
function seedPanelBuyer(db: StubDb, now: string) {
  const last = new Date(Date.parse(now) - 3_600_000).toISOString();
  add(db, "bot_users", [
    shop({
      id: "e2e00000-0000-4000-8000-00000000f001",
      user_key: "telegram:e2e-panel",
      telegram_id: F.CHAT_PANEL_ID,
      platform: "telegram",
      first_name: F.CHAT_PANEL_NAME,
      loyalty_points: F.CHAT_PANEL_POINTS,
    }),
  ]);
  add(db, "manager_chat_state", [
    shop({
      telegram_id: F.CHAT_PANEL_ID,
      active: false,
      last_message_at: last,
      last_message_preview: "Где мой заказ?",
      last_message_direction: "in",
      unread_count: 0,
    }),
  ]);
  const order = (id: number, no: number, status: string) =>
    shop({
      id,
      order_no: no,
      display_no: no,
      status,
      platform: "telegram",
      telegram_id: F.CHAT_PANEL_ID,
      user_key: "telegram:e2e-panel",
      display_name: F.CHAT_PANEL_NAME,
      username: null,
      total: F.CHAT_PANEL_TOTAL,
      paid_amount: 0,
      currency: "KZT",
      fulfillment_kind: "physical",
      created_at: now,
      updated_at: now,
    });
  add(db, "orders", [
    order(970001, F.CHAT_PANEL_ORDER_NO, "delivered"),
    order(970002, F.CHAT_PANEL_CANCELLED_NO, "cancelled"),
  ]);
}
