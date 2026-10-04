import { allConversations } from "./all-conversations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey } from "@/core/customers/customers";
import {
  connect,
  disconnect,
  inboundIntercepted,
  isManagerConnected,
  listMessages,
  markRead,
  recordMessage,
  totalUnread,
} from "@/core/chat/chat";

const CHAT_TG_ID = TEST_TG_ID + 20; // свой id: файлы тестов делят демо-клиента
let ctx: TenantContext;

async function cleanup() {
  const db = serviceDb();
  await db
    .from("manager_chat_messages")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", CHAT_TG_ID);
  await db.from("manager_chat_state").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", CHAT_TG_ID);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", CHAT_TG_ID));
}

describe.skipIf(!liveReady)("чат с менеджером на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...tenant, modules: { ...tenant.modules, manager_chat: true } });
    await cleanup();
    await upsertCustomer(ctx, "telegram", CHAT_TG_ID, { firstName: "Чат", username: "chatprobe" });
  });
  afterAll(cleanup);

  it("без подключённого менеджера бот не перехватывается, но реплика попадает в лог", async () => {
    expect(await inboundIntercepted(ctx, CHAT_TG_ID, "Здравствуйте, есть вопрос")).toBe(false);
    const convs = await allConversations(ctx);
    const c = convs.find((x) => x.telegram_id === CHAT_TG_ID);
    expect(c).toBeTruthy();
    expect(c?.unread_count).toBe(1);
    expect(c?.last_message_preview).toBe("Здравствуйте, есть вопрос");
    expect(c?.first_name).toBe("Чат");
    expect(await totalUnread(ctx)).toBeGreaterThanOrEqual(1);
  });

  it("подключение менеджера перехватывает диалог, отключение возвращает боту", async () => {
    await connect(ctx, CHAT_TG_ID);
    expect(await isManagerConnected(ctx, CHAT_TG_ID)).toBe(true);
    expect(await inboundIntercepted(ctx, CHAT_TG_ID, "👉 Каталог")).toBe(true);
    await recordMessage(ctx, {
      telegramId: CHAT_TG_ID,
      direction: "out",
      sender: "manager",
      text: "Отвечу",
    });
    const { messages: msgs } = await listMessages(ctx, CHAT_TG_ID);
    expect(msgs.map((m) => m.sender)).toEqual(["customer", "customer", "manager"]);
    await markRead(ctx, CHAT_TG_ID);
    const c = (await allConversations(ctx)).find((x) => x.telegram_id === CHAT_TG_ID);
    expect(c?.unread_count).toBe(0);
    expect(c?.last_message_direction).toBe("out");
    await disconnect(ctx, CHAT_TG_ID);
    expect(await inboundIntercepted(ctx, CHAT_TG_ID, "спасибо")).toBe(false);
  });

  it("без модуля — ни перехвата, ни записи", async () => {
    const off = tenantContext({
      ...ctx.tenant,
      modules: { ...ctx.tenant.modules, manager_chat: false },
    });
    const before = (await listMessages(ctx, CHAT_TG_ID)).messages.length;
    expect(await inboundIntercepted(off, CHAT_TG_ID, "тихо")).toBe(false);
    expect((await listMessages(ctx, CHAT_TG_ID)).messages.length).toBe(before);
  });
});
