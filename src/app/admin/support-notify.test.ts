import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Уведомления поддержки: «один раз» на сообщение, гонка, отказ Telegram, нет получателей. */
let db: FakeDb;
const sent: Array<{ chat_id: string; text: string }> = [];
const alerts: string[] = [];
let tgOk = true;
let configured = true;
let recipients: string[] = ["111"];
let tenant: Record<string, unknown>;

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/config/env", () => ({
  env: () => ({ APP_URL: "https://app.test", TELEGRAM_API_BASE: "https://tg.test" }),
}));
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: () => ({
    call: async (_m: string, p: { chat_id: string; text: string }) => {
      sent.push(p);
      return { ok: tgOk, description: tgOk ? undefined : "Forbidden: bot was blocked" };
    },
  }),
}));
vi.mock("@/core/notify/recipients", () => ({ adminRecipients: async () => recipients }));
vi.mock("@/core/catalog/low-stock", () => ({ sellerLocale: async () => "en" }));
vi.mock("@/app/operator/health-alerts.server", () => ({
  alertChannelStatus: async () => ({ configured }),
  sendOperatorAlert: async (h: string) => {
    alerts.push(h);
    return { ok: true };
  },
}));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  requireTenant: async () => tenant,
  tenantContext: (t: unknown) => ({
    tenant: t,
    appUrl: "https://app.test",
    secrets: { telegramToken: () => "tok" },
  }),
}));

const { claimNotice, notifyOperator, notifySeller } = await import("./support-notify.server");

const msg = (id: string) => ({
  id,
  bot_id: "b1",
  thread_id: "t1",
  author: "operator",
  body: "x",
  notified_at: null,
});

beforeEach(() => {
  db = fakeDb();
  db.tables.platform_messages = [msg("m1"), msg("m2")];
  sent.length = 0;
  alerts.length = 0;
  tgOk = true;
  configured = true;
  recipients = ["111"];
  tenant = {
    id: "b1",
    name: "Лавка",
    archived: false,
    telegramTokenEnc: "enc",
    settings: { served_by: "v2" },
  };
});

describe("отметка «уведомили»", () => {
  it("два запуска одновременно: отметку ставит один", async () => {
    const r = await Promise.all([claimNotice("m1"), claimNotice("m1")]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(db.tables.platform_messages![0]!.notified_at).toBeTruthy();
  });
});

describe("ответ оператора — продавцу", () => {
  it("два ответа подряд — два уведомления, на языке админки продавца, со ссылкой", async () => {
    expect(await notifySeller("b1", "m1", "Первый")).toBe("sent");
    expect(await notifySeller("b1", "m2", "Второй")).toBe("sent");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.text).toContain("FrogFlow support replied");
    expect(sent[0]!.text).toContain("https://app.test/admin/support");
  });

  it("один ответ — одно уведомление, даже при повторе и гонке", async () => {
    const r = await Promise.all([
      notifySeller("b1", "m1", "Первый"),
      notifySeller("b1", "m1", "Первый"),
    ]);
    expect([...r].sort()).toEqual(["already", "sent"]);
    expect(await notifySeller("b1", "m1", "Первый")).toBe("already");
    expect(sent).toHaveLength(1);
  });

  it("Telegram отказал — «не дошло», повторно не шлём и отметку не снимаем", async () => {
    tgOk = false;
    expect(await notifySeller("b1", "m1", "Первый")).toBe("failed");
    expect(await notifySeller("b1", "m1", "Первый")).toBe("already");
    expect(sent).toHaveLength(1);
  });

  it("нет получателей — отметка не тратится, можно уведомить позже", async () => {
    recipients = [];
    expect(await notifySeller("b1", "m1", "Первый")).toBe("no_telegram");
    expect(db.tables.platform_messages![0]!.notified_at).toBeNull();
    recipients = ["111"];
    expect(await notifySeller("b1", "m1", "Первый")).toBe("sent");
  });

  it("магазин прежней платформы или в архиве не трогаем", async () => {
    tenant = { ...tenant, settings: { served_by: "v1" } };
    expect(await notifySeller("b1", "m1", "x")).toBe("skipped");
    tenant = { ...tenant, settings: { served_by: "v2" }, archived: true };
    expect(await notifySeller("b1", "m1", "x")).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});

describe("сообщение продавца — оператору", () => {
  it("одно сообщение — одно оповещение со ссылкой на переписку", async () => {
    const r = await Promise.all([
      notifyOperator("b1", "Лавка", "m1", "Не приходят заказы"),
      notifyOperator("b1", "Лавка", "m1", "Не приходят заказы"),
    ]);
    expect([...r].sort()).toEqual(["already", "sent"]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Лавка");
    expect(alerts[0]).toContain("https://app.test/operator/support?bot=b1");
  });

  it("канал оповещений не настроен — тихо пропускаем, отметка цела", async () => {
    configured = false;
    expect(await notifyOperator("b1", "Лавка", "m1", "x")).toBe("skipped");
    expect(db.tables.platform_messages![0]!.notified_at).toBeNull();
    expect(alerts).toHaveLength(0);
  });
});
