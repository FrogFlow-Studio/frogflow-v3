import { describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";
import { buyerLocale } from "@/core/i18n/locale";
import { COPY } from "./copy";

/** Автосообщения без выбранного покупателем языка идут на языке магазина (А7). */
const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
vi.mock("@/config/env", () => ({ env: () => ({ TELEGRAM_API_BASE: undefined }) }));
vi.mock("./api", () => ({
  telegramApi: () => ({
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return { ok: true };
    },
  }),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (tenant: Tenant) => ({
    tenant,
    secrets: { telegramToken: () => "token" },
    appUrl: "https://x",
  }),
}));
vi.mock("@/core/reviews/ask", () => ({
  runReviewAsk: async (_ctx: unknown, send: (c: unknown, ask: unknown) => Promise<boolean>) => {
    await send(
      { platform: "telegram", telegramId: 7, state: {} },
      { products: [{ id: "p", name: "Урок" }], orderNo: 5, orderId: 9 },
    );
    await send(
      { platform: "telegram", telegramId: 8, state: { locale: "xx" } },
      { products: [{ id: "p", name: "Урок" }], orderNo: 6, orderId: 10 },
    );
    return { sent: 2 };
  },
}));
vi.mock("@/core/marketing/auto-v3", () => ({ autoMessagesV3: async () => true }));
const { runReviewAskFor } = await import("./jobs");

describe("язык покупателя в автосообщениях", () => {
  it("buyerLocale: выбранный язык, иначе язык магазина, иначе русский; мусор не годится", () => {
    expect(buyerLocale({ locale: "en" }, "kk")).toBe("en");
    expect(buyerLocale({}, "kk")).toBe("kk");
    expect(buyerLocale({ locale: "xx" }, "uz")).toBe("uz");
    expect(buyerLocale(undefined, null)).toBe("ru");
  });

  it("просьба об оценке в казахском магазине: покупатель без языка получает казахский, не русский", async () => {
    calls.length = 0;
    const tenant = {
      id: "b",
      modules: { review_request: true },
      settings: { default_locale: "kk" },
      telegramTokenEnc: "enc",
    } as unknown as Tenant;
    await runReviewAskFor(tenant);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const text = String(c.params.text);
      expect(text).toBe(COPY.kk.reviewAskOne("Урок"));
      expect(text).not.toBe(COPY.ru.reviewAskOne("Урок"));
      const buttons = (c.params.reply_markup as { inline_keyboard: { text: string }[][] })
        .inline_keyboard;
      expect(buttons.at(-1)![0]!.text).toBe(COPY.kk.unsubscribeBtn);
    }
  });
});
