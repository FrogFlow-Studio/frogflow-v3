import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

// Продавец выбрал почту, а SMTP платформы не настроен: срочное не должно теряться.
const st = vi.hoisted(() => ({
  mailOn: false,
  mailResult: { ok: true } as { ok: boolean; error?: string },
  mails: 0,
  telegram: [] as string[],
  deferred: 0,
}));

vi.mock("@/config/env", () => ({ env: () => ({ TELEGRAM_API_BASE: undefined }) }));
vi.mock("./api", () => ({ telegramApi: () => ({ call: async () => ({ ok: true }) }) }));
vi.mock("@/core/notify/recipients", () => ({ adminRecipients: async () => ["100"] }));
vi.mock("@/core/push/admin-push", () => ({
  vapidFromEnv: () => null,
  pushAdmins: async () => 0,
  pushFromHtml: () => ({}),
}));
vi.mock("@/core/notify/digest", () => ({
  deferToDigest: async () => {
    st.deferred++;
  },
}));
vi.mock("@/core/mail/mail.server", () => ({
  isMailConfigured: () => st.mailOn,
  smtpMailer: async () => {
    st.mails++;
    return st.mailResult;
  },
}));
vi.mock("@/core/outbox/outbox", () => ({
  sendOrEnqueue: async (_c: unknown, msg: { text?: string }) => {
    st.telegram.push(msg.text ?? "");
    return true;
  },
}));

const { notifyAdminsHtml } = await import("./notify");

function ctx(kinds: Record<string, { telegram: boolean; email: boolean }>): TenantContext {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    {
      bot_id: "bot",
      key: "notify_prefs",
      value: JSON.stringify({ kinds, email: "owner@shop.kz" }),
    },
  ];
  return {
    tenant: { id: "bot", telegramTokenEnc: "enc", modules: { notify_in_bot: true }, settings: {} },
    secrets: { telegramToken: () => "t" },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
}

describe("уведомление продавцу: почта выбрана, SMTP не настроен", () => {
  beforeEach(() => {
    st.mailOn = false;
    st.mailResult = { ok: true };
    st.mails = 0;
    st.telegram = [];
    st.deferred = 0;
  });

  it("новый заказ при «только почта» уходит в Telegram и считается доставленным", async () => {
    const n = await notifyAdminsHtml(
      ctx({ new_order: { telegram: false, email: true } }),
      "🛒 Новый заказ #5",
      { kind: "new_order" },
    );
    expect(n).toBe(1);
    expect(st.telegram).toEqual(["🛒 Новый заказ #5"]);
    expect(st.mails).toBe(0);
  });

  it("несрочное «только почта» тоже уходит в Telegram", async () => {
    const n = await notifyAdminsHtml(
      ctx({ question: { telegram: false, email: true } }),
      "❓ Вопрос",
      { kind: "question" },
    );
    expect(n).toBe(1);
    expect(st.telegram).toEqual(["❓ Вопрос"]);
  });

  it("с рабочей почтой «только почта» не трогает Telegram", async () => {
    st.mailOn = true;
    const n = await notifyAdminsHtml(
      ctx({ question: { telegram: false, email: true } }),
      "❓ Вопрос",
      { kind: "question" },
    );
    expect(n).toBe(1);
    expect(st.mails).toBe(1);
    expect(st.telegram).toEqual([]);
  });

  it("сбой SMTP при «только почта» не считается доставкой", async () => {
    st.mailOn = true;
    st.mailResult = { ok: false, error: "connect ETIMEDOUT" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const n = await notifyAdminsHtml(
      ctx({ question: { telegram: false, email: true } }),
      "❓ Вопрос",
      { kind: "question" },
    );
    expect(n).toBe(0);
    expect(st.telegram).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
