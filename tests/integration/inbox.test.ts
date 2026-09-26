import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey } from "@/core/customers/customers";
import { inboundIntercepted, listConversations } from "@/core/chat/chat";
import { createTicket, getTicket } from "@/core/helpdesk/tickets";
import {
  getInboxMeta,
  inboxEventId,
  inboxMetaFor,
  mergeInbox,
  openTicketNumbers,
  setInboxMeta,
} from "@/core/inbox/inbox";

const INBOX_TG_ID = TEST_TG_ID + 21; // свой id: файлы тестов делят демо-клиента
let ctx: TenantContext;

async function cleanup() {
  const db = serviceDb();
  await db
    .from("manager_chat_messages")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", INBOX_TG_ID);
  await db
    .from("manager_chat_state")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", INBOX_TG_ID);
  await db.from("zernio_logs").delete().eq("event_id", inboxEventId(DEMO_BOT, INBOX_TG_ID));
  await db
    .from("zernio_logs")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .like("event_id", "ticket:%")
    .contains("payload", { telegram_id: INBOX_TG_ID });
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", INBOX_TG_ID));
}

describe.skipIf(!liveReady)("единый входящий на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: { ...tenant.modules, manager_chat: true, helpdesk: true },
    });
    await cleanup();
    await upsertCustomer(ctx, "telegram", INBOX_TG_ID, { firstName: "Входящий" });
  });
  afterAll(cleanup);

  it("новый диалог — открыт и ничей, без строки учёта", async () => {
    await inboundIntercepted(ctx, INBOX_TG_ID, "Есть доставка?");
    expect(await getInboxMeta(ctx, INBOX_TG_ID)).toMatchObject({
      status: "open",
      assignee: null,
      updatedAt: null,
    });
  });

  it("назначение и «решено» сохраняются и видны в списке", async () => {
    await setInboxMeta(ctx, INBOX_TG_ID, { assignee: "probe" }, "admin:probe");
    const m = await setInboxMeta(ctx, INBOX_TG_ID, { status: "closed" }, "admin:probe");
    expect(m).toMatchObject({ status: "closed", assignee: "probe", updatedBy: "admin:probe" });
    const convs = await listConversations(ctx);
    const items = mergeInbox(convs, await inboxMetaFor(ctx, [INBOX_TG_ID]));
    expect(items.find((i) => i.telegram_id === INBOX_TG_ID)).toMatchObject({
      status: "closed",
      assignee: "probe",
    });
  });

  it("новая реплика покупателя открывает решённый диалог, ответственный остаётся", async () => {
    await inboundIntercepted(ctx, INBOX_TG_ID, "И ещё вопрос");
    expect(await getInboxMeta(ctx, INBOX_TG_ID)).toMatchObject({
      status: "open",
      assignee: "probe",
    });
  });

  it("«решено» закрывает обращение helpdesk того же покупателя", async () => {
    const { ticket } = await createTicket(ctx, {
      telegramId: INBOX_TG_ID,
      customerName: "Входящий",
      platform: "telegram",
      subject: "Не пришёл файл",
    });
    expect((await openTicketNumbers(ctx, [INBOX_TG_ID])).get(INBOX_TG_ID)).toEqual([ticket.number]);
    await setInboxMeta(ctx, INBOX_TG_ID, { status: "closed" }, "admin:probe");
    expect((await getTicket(ctx, ticket.id))?.status).toBe("closed");
    expect((await openTicketNumbers(ctx, [INBOX_TG_ID])).get(INBOX_TG_ID)).toBeUndefined();
  });

  it("учёт чужого бота не виден: строка под ключом демо-бота", async () => {
    const { data } = await serviceDb()
      .from("zernio_logs")
      .select("bot_id, event_type")
      .eq("event_id", inboxEventId(DEMO_BOT, INBOX_TG_ID))
      .single();
    expect(data).toEqual({ bot_id: DEMO_BOT, event_type: "inbox" });
  });
});
