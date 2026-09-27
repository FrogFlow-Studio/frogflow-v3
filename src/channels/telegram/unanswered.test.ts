import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

const notifyAdminsHtml = vi.fn(async () => 1);
vi.mock("./notify", () => ({ notifyAdminsHtml, notifyDeliveryFailure: vi.fn() }));
const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (tenant: unknown) => ({ tenant, db, appUrl: "https://app.test" }),
}));

const { runUnansweredChats, waitedLabel } = await import("./jobs");

describe("сообщение о диалоге без ответа", () => {
  it("сколько ждёт — минутами и часами", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(waitedLabel("2026-09-27T11:48:00Z", now)).toBe("12 мин");
    expect(waitedLabel("2026-09-27T10:00:00Z", now)).toBe("2 ч");
    expect(waitedLabel("2026-09-27T09:55:00Z", now)).toBe("2 ч 5 мин");
  });

  it("имя, канал, ответственный и ссылка на диалог; без модуля и выключенное — молчит", async () => {
    const at = new Date(Date.now() - 45 * 60_000).toISOString();
    db.tables.app_settings = [{ key: "chat_unanswered_minutes", value: "30" }];
    db.tables.manager_chat_state = [
      { bot_id: "b", telegram_id: -5, active: true, last_message_at: at, unread_count: 1 },
    ];
    db.tables.manager_chat_messages = [
      {
        id: "m1",
        bot_id: "b",
        telegram_id: -5,
        direction: "in",
        sender: "customer",
        text: "<b>есть размер M?</b>",
        created_at: at,
      },
    ];
    db.tables.zernio_logs = [];
    db.tables.bot_users = [
      { user_key: "ig:1", platform: "instagram", telegram_id: -5, first_name: "Аня", state: {} },
    ];
    const tenant = { id: "b", modules: { manager_chat: true }, settings: {} } as never;

    expect(await runUnansweredChats({ ...(tenant as object), modules: {} } as never)).toEqual({
      skipped: "module off",
    });
    await runUnansweredChats(tenant);
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    const [, html, opts] = notifyAdminsHtml.mock.calls[0] as unknown as [unknown, string, unknown];
    expect(html).toContain("Покупатель ждёт ответа 45 мин");
    expect(html).toContain("Instagram · 👤 Аня");
    expect(html).toContain("Ответственный не назначен");
    expect(html).toContain("&lt;b&gt;есть размер M?&lt;/b&gt;");
    expect(html).toContain("https://app.test/admin/chat?c=-5");
    expect(opts).toEqual({ kind: "question" });

    db.tables.app_settings = [{ key: "chat_unanswered_minutes", value: "0" }];
    expect(await runUnansweredChats(tenant)).toEqual({ skipped: "off" });
  });
});
