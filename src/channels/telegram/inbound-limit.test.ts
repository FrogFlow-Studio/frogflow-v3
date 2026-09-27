import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Telegram: лимит входящих считает личку и кнопки покупателя, продавец не ограничен. */
let verdicts: string[] = [];
const subjects: string[] = [];
let exemptResult: boolean | null = null;
vi.mock("@/core/customers/inbound-rate", () => ({
  admitInbound: vi.fn(async (_ctx: unknown, subject: string, exempt?: () => Promise<boolean>) => {
    subjects.push(subject);
    const v = verdicts.shift() ?? "ok";
    if (v !== "ok" && exempt) {
      exemptResult = await exempt();
      if (exemptResult) return "ok";
    }
    return v;
  }),
  floodNoticeHtml: (channel: string, who: string) => `${channel}:${who}`,
}));
let adminIds: string | null = "555";
let adminError: { message: string } | null = null;

const { telegramInboundAllowed } = await import("./inbound-limit");
const ctx = {
  tenant: { id: "b", ownerTelegramId: 777 },
  db: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            adminError
              ? { data: null, error: adminError }
              : { data: adminIds ? { value: adminIds } : null, error: null },
        }),
      }),
    }),
  },
} as unknown as TenantContext;

beforeEach(() => {
  verdicts = [];
  subjects.length = 0;
  exemptResult = null;
  adminIds = "555";
  adminError = null;
});

describe("лимит входящих в Telegram", () => {
  it("сверх лимита — не обрабатываем, продавцу одно уведомление с экранированным именем", async () => {
    const notify = vi.fn(async () => {});
    verdicts = ["limited_notify", "limited"];
    const u = { message: { from: { id: 7, first_name: "<b>Ян</b>" }, chat: { type: "private" } } };
    expect(await telegramInboundAllowed(ctx, u, notify)).toBe(false);
    expect(await telegramInboundAllowed(ctx, u, notify)).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Telegram:&lt;b&gt;Ян&lt;/b&gt;");
    expect(subjects).toEqual(["tg_7", "tg_7"]);
  });

  it("кнопки считаются, группы и обновления без отправителя — нет", async () => {
    const notify = vi.fn(async () => {});
    expect(await telegramInboundAllowed(ctx, { callback_query: { from: { id: 8 } } }, notify)).toBe(
      true,
    );
    expect(
      await telegramInboundAllowed(
        ctx,
        { message: { from: { id: 9 }, chat: { type: "supergroup" } } },
        notify,
      ),
    ).toBe(true);
    expect(await telegramInboundAllowed(ctx, {}, notify)).toBe(true);
    expect(subjects).toEqual(["tg_8"]);
  });

  it("оплата и /start с параметром не считаются вовсе", async () => {
    verdicts = ["limited", "limited"];
    const pay = { message: { from: { id: 7 }, chat: { type: "private" }, successful_payment: {} } };
    const start = { message: { from: { id: 7 }, chat: { type: "private" }, text: "/start ord_5" } };
    expect(await telegramInboundAllowed(ctx, pay, vi.fn())).toBe(true);
    expect(await telegramInboundAllowed(ctx, start, vi.fn())).toBe(true);
    expect(subjects).toEqual([]);
  });

  it("владелец и сбой чтения списка продавцов — пропускаем", async () => {
    verdicts = ["limited", "limited"];
    const owner = { message: { from: { id: 777 }, chat: { type: "private" } } };
    expect(await telegramInboundAllowed(ctx, owner, vi.fn())).toBe(true);
    adminError = { message: "timeout" };
    const other = { message: { from: { id: 8 }, chat: { type: "private" } } };
    expect(await telegramInboundAllowed(ctx, other, vi.fn())).toBe(true);
  });

  it("продавец сверх лимита — пропускаем", async () => {
    verdicts = ["limited"];
    const u = { message: { from: { id: 555 }, chat: { type: "private" } } };
    expect(await telegramInboundAllowed(ctx, u, vi.fn())).toBe(true);
    expect(exemptResult).toBe(true);
  });
});
