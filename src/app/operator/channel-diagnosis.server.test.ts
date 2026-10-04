import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { ZERNIO_WEBHOOK_EVENTS } from "@/channels/zernio/webhook-fit";

let db: FakeDb;
let tenant: Record<string, unknown>;
const tgCalls: string[] = [];
let tgWebhookUrl = "https://app.example/api/telegram/webhook/bot-1";
let zernioCalls: string[] = [];
let zernioAccounts: Array<Record<string, unknown>> = [];
let zernioFail = false;

vi.mock("@/config/env", () => ({
  env: () => ({ APP_URL: "https://app.example", TELEGRAM_API_BASE: undefined }),
}));
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => tenant,
  tenantContext: () => ({ secrets: { telegramToken: () => "token" } }),
}));
vi.mock("@/channels/telegram/secret", () => ({
  telegramWebhookUrl: (app: string, id: string) => `${app}/api/telegram/webhook/${id}`,
}));
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: () => ({
    call: async (method: string) => {
      tgCalls.push(method);
      if (method === "getMe") return { ok: true, result: { username: "shop_bot" } };
      if (method === "getWebhookInfo")
        return { ok: true, result: { url: tgWebhookUrl, pending_update_count: 0 } };
      throw new Error(`Диагностика не должна вызывать ${method}`);
    },
  }),
}));
vi.mock("@/channels/zernio/api.server", () => ({
  zernioConfigured: () => true,
  listAccounts: async () => {
    zernioCalls.push("listAccounts");
    if (zernioFail) throw new Error("Zernio API: нет ответа");
    return zernioAccounts;
  },
  readWebhookSettings: async () => {
    zernioCalls.push("readWebhookSettings");
    return [
      {
        _id: "w1",
        url: "https://app.example/api/zernio/webhook",
        isActive: true,
        profileIds: ["prof-1"],
        events: [...ZERNIO_WEBHOOK_EVENTS],
      },
    ];
  },
}));
vi.mock("./operator.server", () => ({
  zernioLastEvents: async () => new Map([["*", "2026-10-19T10:00:00Z"]]),
}));

const { diagnoseChannel } = await import("./channel-diagnosis.server");
const by = (d: { checks: { key: string; state: string }[] }, key: string) =>
  d.checks.find((c) => c.key === key)!;

beforeEach(() => {
  db = fakeDb({ maxRows: 1000 });
  tgCalls.length = 0;
  zernioCalls = [];
  zernioFail = false;
  tgWebhookUrl = "https://app.example/api/telegram/webhook/bot-1";
  zernioAccounts = [{ _id: "acc-1", platform: "instagram", isExpired: false }];
  tenant = {
    id: "bot-1",
    telegramTokenEnc: "enc",
    settings: {
      served_by: "v2",
      zernio: {
        profile_id: "prof-1",
        accounts: [
          { id: "acc-1", platform: "instagram", username: "shop" },
          { id: "acc-2", platform: "whatsapp", username: null },
        ],
      },
    },
  };
  db.tables.zernio_logs = [
    {
      id: "l1",
      bot_id: "bot-1",
      event_id: "tg:bot-1:5",
      event_type: "telegram.update",
      status: "processed",
      payload: {},
      created_at: "2026-10-19T09:00:00Z",
    },
    {
      id: "l2",
      bot_id: "bot-1",
      event_id: "e2",
      event_type: "message.failed",
      status: "processed",
      payload: { error: { code: 131026 } },
      created_at: "2026-10-18T09:00:00Z",
    },
  ];
});

describe("диагностика канала на сервере", () => {
  it("Telegram: спрашивает только getMe и getWebhookInfo, журнал не меняется", async () => {
    const before = JSON.stringify(db.tables);
    const d = await diagnoseChannel("bot-1", "telegram");
    expect(tgCalls).toEqual(["getMe", "getWebhookInfo"]);
    expect(d.verdict).toBe("ok");
    expect(by(d, "last-event").state).toBe("ok");
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("Telegram: вебхук на чужом адресе — не ок", async () => {
    tgWebhookUrl = "https://v1.example/hook";
    const d = await diagnoseChannel("bot-1", "telegram");
    expect(d.verdict).toBe("bad");
    expect(by(d, "webhook").state).toBe("bad");
  });

  it("Telegram, клиент на v1: вебхук не спрашивается", async () => {
    (tenant.settings as Record<string, unknown>).served_by = "v1";
    const d = await diagnoseChannel("bot-1", "telegram");
    expect(tgCalls).toEqual(["getMe"]);
    expect(by(d, "webhook").state).toBe("info");
  });

  it("Instagram: читает аккаунты и вебхуки Zernio, ничего не пишет", async () => {
    const before = JSON.stringify(db.tables);
    const d = await diagnoseChannel("bot-1", "instagram");
    expect(zernioCalls).toEqual(["listAccounts", "readWebhookSettings"]);
    expect(d.verdict).toBe("ok");
    expect(by(d, "last-event").state).toBe("ok");
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("WhatsApp: последний отказ доставки из журнала со словами продавца", async () => {
    zernioAccounts = [{ _id: "acc-2", platform: "whatsapp", isExpired: false }];
    const d = await diagnoseChannel("bot-1", "whatsapp");
    const failed = d.checks.find((c) => c.key === "send-error")!;
    expect(failed.detail).toMatch(/не принимает сообщения WhatsApp/);
  });

  it("Zernio не ответил — «не ок, неизвестно», без падения и без повтора", async () => {
    zernioFail = true;
    const d = await diagnoseChannel("bot-1", "instagram");
    expect(zernioCalls.filter((c) => c === "listAccounts")).toHaveLength(1);
    const live = d.checks.find((c) => c.key === "live")!;
    expect(live.state).toBe("bad");
    expect(live.detail).toMatch(/неизвестно/);
  });

  it("сбой чтения журнала — пункт «не прочитан», а не «событий нет» и не падение", async () => {
    const orig = db.from.bind(db);
    db.from = (t: string) => {
      if (t !== "zernio_logs") return orig(t);
      const q: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, k) =>
            k === "then"
              ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } })
              : () => q,
        },
      );
      return q as never;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = await diagnoseChannel("bot-1", "telegram");
    expect(by(d, "last-event").state).toBe("info");
    expect(d.checks.find((c) => c.key === "last-event")!.detail).toMatch(/не прочитан/);
    warn.mockRestore();
  });

  it("у клиента нет профиля Zernio — в Zernio не ходим", async () => {
    (tenant.settings as { zernio: { profile_id: string | null } }).zernio.profile_id = null;
    const d = await diagnoseChannel("bot-1", "instagram");
    expect(zernioCalls).toEqual([]);
    expect(by(d, "profile").state).toBe("bad");
  });
});
