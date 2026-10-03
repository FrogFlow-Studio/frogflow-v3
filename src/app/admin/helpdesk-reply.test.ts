import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Ответ из обращения: createServerFn вызывает обработчик напрямую, гварды и отправка — заглушки. */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return async (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));

const BOT = "11111111-1111-1111-1111-111111111111";
let db: FakeDb;
let me: { username: string } | null = { username: "anna" };
const sent: Array<{ telegramId: number; text: string; draftId?: string }> = [];
const paused: number[] = [];
let ctxTenant: Record<string, unknown>;

vi.mock("@/app/auth/guards.server", () => ({
  requireAdminModule: async () => ({ tenant: ctxTenant, db }),
  adminIdentity: async () => me,
  adminActor: async () => "admin:anna",
}));
vi.mock("./admin.server", () => ({
  replyAsManager: async (
    _ctx: unknown,
    telegramId: number,
    text: string,
    _att: unknown,
    draftId?: string,
  ) => void sent.push({ telegramId, text, draftId }),
  pauseBotAfterManagerReply: async (_ctx: unknown, id: number) => void paused.push(id),
}));

const { ticketReplyFn } = await import("./helpdesk.functions");
const { createTicket } = await import("@/core/helpdesk/tickets");

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  ctxTenant = {
    id: BOT,
    modules: { helpdesk: true, manager_chat: true },
    settings: { admin: { username: "owner", users: [{ username: "anna", role: "manager" }] } },
  };
  me = { username: "anna" };
  sent.length = 0;
  paused.length = 0;
});

let seq = 0;
const open = async (telegramId = 5) => {
  const { ticket } = await createTicket({ tenant: ctxTenant, db } as unknown as TenantContext, {
    telegramId,
    customerName: "Аня",
    platform: "telegram",
    subject: "Где заказ?",
  });
  // Идентификатор строки в памяти — не uuid, а функция проверяет uuid.
  const id = `cccccccc-0000-4000-8000-00000000000${++seq}`;
  db.tables.zernio_logs!.find((r) => r.id === ticket.id)!.id = id;
  return { ...ticket, id };
};
const DRAFT = "aaaaaaaa-0000-4000-8000-000000000000";

describe("ответ покупателю из обращения", () => {
  it("уходит покупателю этого обращения, бот замолкает, ничьё обращение достаётся ответившему", async () => {
    const t = await open();
    await ticketReplyFn({ data: { id: t.id, text: "  Уже едем, №128  ", draftId: DRAFT } });
    expect(sent).toEqual([{ telegramId: 5, text: "Уже едем, №128", draftId: DRAFT }]);
    expect(paused).toEqual([5]);
    const payload = db.tables.zernio_logs![0]!.payload as { assignee: string };
    expect(payload.assignee).toBe("anna");
  });

  it("уже назначенного ответственного не перебивает", async () => {
    const t = await open();
    (db.tables.zernio_logs![0]!.payload as { assignee: string | null }).assignee = "owner";
    await ticketReplyFn({ data: { id: t.id, text: "Ок" } });
    expect((db.tables.zernio_logs![0]!.payload as { assignee: string }).assignee).toBe("owner");
  });

  it("несуществующее обращение и пустой текст — отказ, ничего не отправлено", async () => {
    await expect(
      ticketReplyFn({ data: { id: "bbbbbbbb-0000-4000-8000-000000000000", text: "Ок" } }),
    ).rejects.toBeTruthy();
    const t = await open();
    await expect(ticketReplyFn({ data: { id: t.id, text: "   " } })).rejects.toBeTruthy();
    expect(sent).toEqual([]);
  });
});
