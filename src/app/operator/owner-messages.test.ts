import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";

/** «Написать владельцу»: шаблон на языке клиента, отправка, журнал в карточке. */
let db: FakeDb;
const sentTo: Array<{ chat_id: string; text: string }> = [];
let admins: string[] = ["111"];

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/config/env", () => ({
  env: () => ({ APP_TIMEZONE: "Asia/Almaty", TELEGRAM_API_BASE: "https://tg.test" }),
}));
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: () => ({
    call: async (_m: string, p: { chat_id: string; text: string }) => {
      sentTo.push(p);
      return { ok: true };
    },
  }),
}));
vi.mock("@/core/notify/recipients", () => ({ adminRecipients: async () => admins }));
let locale = "kk";
vi.mock("@/core/ai/seller-text", () => ({ sellerLocaleSafe: async () => locale }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  requireTenant: async () => ({ id: "b1", name: "Лавка", settings: {} }),
  tenantContext: (tenant: unknown) => ({
    tenant,
    secrets: { telegramToken: () => "t" },
  }),
  tenantDirectory: async () => [],
  invalidateTenantDirectory: () => {},
}));

const { notifyOwner, ownerMessageDraft, listOwnerMessages } = await import("./operator.server");

beforeEach(() => {
  db = fakeDb();
  db.tables.bot_events = [];
  db.tables.bots = [{ id: "b1", subscription_expires_at: "2026-10-20T10:00:00Z" }];
  sentTo.length = 0;
  admins = ["111"];
  locale = "kk";
});

describe("сообщение владельцу", () => {
  it("шаблон — на языке продавца, с названием магазина и сроком оплаты", async () => {
    const d = await ownerMessageDraft("b1");
    expect(d.locale).toBe("kk");
    const pay = d.templates.find((t) => t.key === "payment")!;
    expect(pay.text).toContain("Лавка");
    expect(pay.text).toContain("20.10.2026");
    expect(pay.text).toContain("жазылымы");
  });

  it("отправка: сообщение дошло и осталось в журнале целиком, с шаблоном и итогом", async () => {
    const text = "Здравствуйте! ".repeat(40);
    const r = await notifyOwner("b1", text, "checkin");
    expect(r.ok).toBe(true);
    expect(sentTo).toEqual([{ chat_id: "111", text }]);
    const log = await listOwnerMessages("b1");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ text, template: "checkin", delivered: 1, failed: 0 });
  });

  it("некому слать — в журнале «доставлено 0», а не пропуск", async () => {
    admins = [];
    const r = await notifyOwner("b1", "текст");
    expect(r.noRecipients).toBe(true);
    expect((await listOwnerMessages("b1"))[0]).toMatchObject({ delivered: 0, template: null });
  });

  it("журнал других клиентов и других событий не показывается", async () => {
    db.tables.bot_events!.push(
      {
        id: "1",
        bot_id: "other",
        kind: "message",
        at: "2026-10-01T00:00:00Z",
        payload: { text: "чужое" },
      },
      { id: "2", bot_id: "b1", kind: "pause", at: "2026-10-01T00:00:00Z", payload: {} },
    );
    expect(await listOwnerMessages("b1")).toEqual([]);
  });

  it("журнал не прочитался — ошибка, а не «Пока ничего»", async () => {
    db = withBrokenReads(db, ["bot_events"]);
    await expect(listOwnerMessages("b1")).rejects.toThrow(/журнал сообщений не прочитан/);
  });
});
