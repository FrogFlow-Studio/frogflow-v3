/** Общее для интеграционных тестов: живая база, гейт по окружению. */
export const DEMO_BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f"; // «Демо-тестер»
export const OTHER_BOT = "0bac1f86-5231-4e57-838d-2faa44d427e7"; // Educational Bot
export const TEST_TG_ID = 990000001; // синтетический покупатель для записи

export const liveReady = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_JWT_SECRET,
);

/**
 * Удалить тестовый заказ демо-клиента вместе с его журналом событий
 * (zernio_logs `order:<id>:*`) и пачкой уведомления продавцу
 * (app_settings `v2_order_notify:<id>`): ни то, ни другое не каскадится от
 * заказа и иначе копится на демо-клиенте после каждого прогона.
 */
export async function dropDemoOrder(id: number): Promise<void> {
  const { serviceDb } = await import("@/core/db/client.server");
  const db = serviceDb();
  await db.from("zernio_logs").delete().eq("bot_id", DEMO_BOT).like("event_id", `order:${id}:%`);
  await dropOrderNotify(id);
  await db.from("orders").delete().eq("bot_id", DEMO_BOT).eq("id", id);
}

/** Пачка уведомления продавцу о заказе демо-клиента (core/notify/order-pack). */
export async function dropOrderNotify(id: number): Promise<void> {
  const { serviceDb } = await import("@/core/db/client.server");
  const { adminNotifySettingKey } = await import("@/core/notify/order-pack");
  await serviceDb()
    .from("app_settings")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("key", adminNotifySettingKey(id));
}
