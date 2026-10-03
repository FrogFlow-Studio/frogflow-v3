import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";
import { matchDirectCommand } from "./shop-flow";
import { COPY } from "@/channels/telegram/copy";

/** Слово «баллы» в Instagram/WhatsApp: баланс и потолок списания, без вопроса продавцу. */
function shopFor(opts: { loyalty: boolean; points: number; locale?: string; maxRedeem?: string }) {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      loyalty_points: opts.points,
      state: {},
    },
  ];
  db.tables.app_settings = [
    { bot_id: "bot-1", key: "shop_currency", value: "KZT" },
    { bot_id: "bot-1", key: "loyalty_earn_percent", value: "7" },
    ...(opts.maxRedeem
      ? [{ bot_id: "bot-1", key: "loyalty_max_redeem_percent", value: opts.maxRedeem }]
      : []),
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: { loyalty: opts.loyalty },
      settings: {},
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "ig_1",
    platform: "instagram",
    telegramId: -1,
    loyaltyPoints: opts.points,
    state: { locale: opts.locale ?? "ru", mode: "idle" },
  } as unknown as Customer;
  const say = (text: string) =>
    handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "conv-1",
        accountId: "acc-1",
        platform: "instagram",
        text,
        postbackPayload: null,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  return { db, say, sent, transport };
}

describe("Direct: слово «баллы»", () => {
  it("разбор слова на ru, kk, en, uz; обычная фраза про баллы — не команда", () => {
    for (const w of [
      "Баллы",
      "мои баллы!",
      "ұпай",
      "Менің ұпайларым",
      "points",
      "My points",
      "ballar",
      "Mening ballarim",
    ])
      expect(matchDirectCommand(w), w).toBe("points");
    expect(matchDirectCommand("а баллы можно списать на торт?")).toBeNull();
  });

  it("баланс и потолок списания из настройки", async () => {
    const { say, sent } = shopFor({ loyalty: true, points: 350, maxRedeem: "30" });
    expect((await say("баллы")).outcome).toBe("handled");
    expect(sent.at(-1)).toContain("350");
    expect(sent.at(-1)).toContain("1 балл = 1 KZT");
    expect(sent.at(-1)).toContain("до 30%");
  });

  it("уровень и сколько до следующего — из уровней лояльности и выданных заказов", async () => {
    const sh = shopFor({ loyalty: true, points: 120 });
    sh.db.tables.app_settings!.push({
      bot_id: "bot-1",
      key: "loyalty_tiers",
      value: JSON.stringify([
        { name: "Серебро", from: 10000, percent: 7 },
        { name: "Золото", from: 50000, percent: 10 },
      ]),
    });
    sh.db.tables.orders = [
      { id: 1, telegram_id: -1, status: "delivered", total: 12000, currency: "KZT" },
    ];
    await sh.say("баллы");
    expect(sh.sent.at(-1)).toContain("Серебро");
    expect(sh.sent.at(-1)).toContain("38000");
  });

  it("баллов нет, но уровень есть — копятся по проценту уровня, а не общему", async () => {
    const sh = shopFor({ loyalty: true, points: 0 });
    sh.db.tables.app_settings!.push({
      bot_id: "bot-1",
      key: "loyalty_tiers",
      value: JSON.stringify([{ name: "Серебро", from: 1000, percent: 9 }]),
    });
    sh.db.tables.orders = [
      { id: 1, telegram_id: -1, status: "delivered", total: 5000, currency: "KZT" },
    ];
    await sh.say("баллы");
    expect(sh.sent.at(-1)).toContain("9%");
    expect(sh.sent.at(-1)).not.toContain("7%");
  });

  it("баллов нет — объясняет, как они копятся", async () => {
    const { say, sent } = shopFor({ loyalty: true, points: 0 });
    await say("мои баллы");
    expect(sent.at(-1)).toContain("7%");
  });

  it("на kk, en, uz тоже отвечает", async () => {
    for (const [locale, word] of [
      ["kk", "ұпай"],
      ["en", "points"],
      ["uz", "ballar"],
    ] as const) {
      const { say, sent } = shopFor({ loyalty: true, points: 10, locale });
      await say(word);
      expect(sent.at(-1)).toContain(COPY[locale].pointsInfo(10, "KZT", 100).slice(0, 12));
    }
  });

  it("модуль loyalty выключен — слово не перехватывается, ответа нет", async () => {
    const { say, sent } = shopFor({ loyalty: false, points: 350 });
    expect((await say("баллы")).outcome).toBe("question");
    expect(sent).toHaveLength(0);
  });
});
