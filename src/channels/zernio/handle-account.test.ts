import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
const patchTenantSettings = vi.fn(async () => {});
vi.mock("@/core/tenant/resolve.server", () => ({ patchTenantSettings }));
/** Адресаты — admin_chat_id продавца (notifyAdminsHtml); здесь их число задаёт тест. */
let recipients: string[] = [];
const sentTo: string[][] = [];
const notifyAdminsHtml = vi.fn(async () => {
  sentTo.push([...recipients]);
  return recipients.length;
});
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));

const { handleAccountDisconnected } = await import("./handle-account");

const BOT = "11111111-1111-1111-1111-111111111111";
const ctxOf = () =>
  ({
    tenant: {
      id: BOT,
      settings: { zernio: { accounts: [{ id: "acc-1", expired: false }] } },
    },
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
  }) as unknown as TenantContext;
const event = (accountId: string) => ({
  account: { accountId, username: "aa_teach_", platform: "instagram" },
});

beforeEach(() => {
  vi.useRealTimers();
  recipients = ["111", "222"];
  sentTo.length = 0;
  notifyAdminsHtml.mockClear();
  patchTenantSettings.mockClear();
});

describe("Zernio: аккаунт отключился (опись v1: tests/zernio-account-disconnected.test.ts)", () => {
  it("уведомляет продавца по всем адресам из admin_chat_id и помечает аккаунт", async () => {
    const r = await handleAccountDisconnected(ctxOf(), event("acc-1"));
    expect(r.notified).toBe(true);
    expect(sentTo).toEqual([["111", "222"]]);
    expect(patchTenantSettings).toHaveBeenCalledWith(BOT, {
      zernio: { accounts: [{ id: "acc-1", expired: true }] },
    });
  });

  it("без настроенного admin_chat_id ничего не отправляет", async () => {
    recipients = [];
    const r = await handleAccountDisconnected(ctxOf(), event("acc-1"));
    expect(r).toMatchObject({ notified: false, note: "некому уведомить" });
  });

  it("не повторяет уведомление о том же аккаунте раньше шести часов", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    const ctx = ctxOf();
    expect((await handleAccountDisconnected(ctx, event("acc-1"))).notified).toBe(true);
    vi.setSystemTime(new Date("2026-09-26T15:59:00Z"));
    expect(await handleAccountDisconnected(ctx, event("acc-1"))).toMatchObject({
      notified: false,
      note: "уже уведомляли недавно",
    });
    vi.setSystemTime(new Date("2026-09-26T16:01:00Z"));
    expect((await handleAccountDisconnected(ctx, event("acc-1"))).notified).toBe(true);
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(2);
  });

  it("другой аккаунт уведомляется даже пока первый ещё в кулдауне", async () => {
    const ctx = ctxOf();
    await handleAccountDisconnected(ctx, event("acc-1"));
    expect((await handleAccountDisconnected(ctx, event("acc-2"))).notified).toBe(true);
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(2);
  });
});
