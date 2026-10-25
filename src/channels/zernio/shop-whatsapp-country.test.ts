import { describe, expect, it, vi } from "vitest";
import { askCountry, payLinkOf, sendManualInstructions, sendPayLink } from "./shop/checkout.server";
import type { Shop } from "./shop/context.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { fakeDb } from "../../../tests/fake-db";
import { COPY } from "@/channels/telegram/copy";
import { DEFAULT_DIRECT_BOT } from "@/core/instagram/direct-bot-settings";

const BOT = "11111111-1111-1111-1111-111111111111";

describe("WhatsApp Zero-Friction: авто-определение страны по телефону", () => {
  const methods = [
    {
      id: "pm1",
      bot_id: BOT,
      is_active: true,
      sort_order: 1,
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
    },
    {
      id: "pm2",
      bot_id: BOT,
      is_active: true,
      sort_order: 2,
      country_code: "RU",
      country_name: "Россия",
      currency: "RUB",
    },
  ];

  function createShop(opts: {
    userKey: string;
    contactPhone?: string | null;
    platform?: "whatsapp" | "instagram";
  }): {
    s: Shop;
    sent: string[];
    sentOpts: Array<Record<string, unknown> | undefined>;
    db: ReturnType<typeof fakeDb>;
  } {
    const db = fakeDb();
    db.tables.bot_users = [
      { id: "u1", bot_id: BOT, user_key: opts.userKey, state: { locale: "ru" } },
    ];
    db.tables.payment_methods = methods;
    db.tables.cart_items = [];
    db.tables.products = [];

    const ctx = {
      tenant: { id: BOT, modules: { whatsapp: true, wa_shop: true }, settings: {} },
      db: {
        from: (t: string) => db.from(t),
        rpc: (name: string, args: Record<string, unknown>) =>
          name === "claim_order_placement"
            ? Promise.resolve({ data: false, error: null })
            : db.rpc(name, args),
      },
      appUrl: "https://app.test",
    } as unknown as TenantContext;

    const customer: Customer = {
      userKey: opts.userKey,
      platform: opts.platform ?? "whatsapp",
      telegramId: -1,
      username: null,
      firstName: "Покупатель",
      lastName: null,
      languageCode: null,
      contactPhone: opts.contactPhone ?? null,
      email: null,
      loyaltyPoints: 0,
      state: { locale: "ru" },
      zernioConversationId: "conv-1",
      zernioAccountId: "acc-1",
    };

    const sent: string[] = [];
    const sentOpts: Array<Record<string, unknown> | undefined> = [];
    const transport = {
      send: vi.fn(async (_c, _a, text: string, opts?: Record<string, unknown>) => {
        sent.push(text);
        sentOpts.push(opts);
        return { ok: true };
      }),
      tail: vi.fn(async () => []),
      download: vi.fn(async () => null),
      mailReady: () => false,
    };

    const s: Shop = {
      inboundAt: Date.now(),
      ctx,
      customer,
      transport,
      conversationId: "conv-1",
      accountId: "acc-1",
      platform: opts.platform ?? "whatsapp",
      locale: "ru",
      m: COPY["ru"],
      bot: DEFAULT_DIRECT_BOT,
    };

    return { s, sent, sentOpts, db };
  }

  it("покупатель из Казахстана в WhatsApp (+7 701...) сразу получает KZ без шага выбора страны", async () => {
    const { s } = createShop({
      userKey: "wa_77011234567",
      contactPhone: "+77011234567",
    });

    await askCountry(s, true);

    expect(s.customer.state.country_code).toBe("KZ");
    expect(s.customer.state.country_name).toBe("Казахстан");
    expect(s.customer.state.mode).not.toBe("awaiting_country");
  });

  it("покупатель из России в WhatsApp (+7 926...) сразу получает RU без шага выбора страны", async () => {
    const { s } = createShop({
      userKey: "wa_79261234567",
      contactPhone: "+79261234567",
    });

    await askCountry(s, true);

    expect(s.customer.state.country_code).toBe("RU");
    expect(s.customer.state.country_name).toBe("Россия");
    expect(s.customer.state.mode).not.toBe("awaiting_country");
  });

  it("покупатель без подходящего способа оплаты (Кыргызстан +996) видит список выбора стран", async () => {
    const { s, sent } = createShop({
      userKey: "wa_996555123456",
      contactPhone: "+996555123456",
    });

    await askCountry(s, true);

    expect(s.customer.state.mode).toBe("awaiting_country");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatch(/страну|Казахстан|Россия/i);
  });

  it("sendManualInstructions в WhatsApp оставляет ссылку Kaspi в тексте без неработающей кнопки", async () => {
    const { s, sent, sentOpts } = createShop({
      userKey: "wa_77011234567",
      contactPhone: "+77011234567",
      platform: "whatsapp",
    });

    const kaspiUrl = "https://pay.kaspi.kz/pay/test12345";
    expect(payLinkOf(`Переведите по ссылке: ${kaspiUrl}`)).toBe(kaspiUrl);

    await sendManualInstructions(s, {
      no: 101,
      due: 5000,
      currency: "KZT",
      instructions: `Оплата Kaspi: ${kaspiUrl}`,
      qr: null,
      physical: false,
      depositLine: "",
    });

    expect(sentOpts.length).toBe(1);
    expect(sent[0]).toContain(kaspiUrl);
    expect(sentOpts[0]?.buttons).toBeUndefined();
  });

  it("для онлайн-оплаты WhatsApp получает кликабельную ссылку текстом, Instagram — URL-кнопку", async () => {
    const url = "https://pay.example/checkout/270";
    const wa = createShop({ userKey: "wa_77011234567", platform: "whatsapp" });
    await sendPayLink(wa.s, "Заказ №270. Оплатите по ссылке:", "Оплатить", url);
    expect(wa.sent[0]).toContain(url);
    expect(wa.sentOpts[0]?.buttons).toBeUndefined();

    const ig = createShop({ userKey: "ig_123", platform: "instagram" });
    await sendPayLink(ig.s, "Заказ №270. Оплатите по ссылке:", "Оплатить", url);
    expect((ig.sentOpts[0]?.buttons as Array<{ type: string; url: string }>)[0]).toMatchObject({
      type: "url",
      url,
    });
  });
});
