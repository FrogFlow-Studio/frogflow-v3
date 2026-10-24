import { setEnvForTests } from "@/config/env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";

/**
 * Ответ консультанта в Direct: что видит продавец, когда отправка не
 * подтверждена, и какие строки остаются в журнале ответов (consultant_message_runs).
 */

const customer = {
  userKey: "ig:1",
  platform: "instagram",
  telegramId: -1,
  firstName: "Аня",
  state: { consultant: {} },
} as unknown as Customer;

vi.mock("@/core/customers/customers", () => ({
  upsertCustomer: vi.fn(async () => customer),
  isBlocked: vi.fn(async () => false),
  setState: vi.fn(async (_c: unknown, c: Customer) => c),
}));
const notifyAdminsHtml = vi.fn(async (_ctx: unknown, _html: string, _o?: unknown) => 1);
vi.mock("@/channels/telegram/notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/channels/telegram/notify")>();
  return {
    ...actual,
    notifyAdminsHtml,
    adminTelegramApi: () => null,
  };
});
vi.mock("@/core/instagram/direct-bot-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/instagram/direct-bot-settings")>();
  return {
    ...actual,
    loadDirectBotSettings: vi.fn(async () => ({
      enabled: true,
      ignoreExcluded: false,
      triggers: [],
      features: { express: true, cart: true, checkout: true, catalog: true },
    })),
  };
});
vi.mock("@/core/pipeline/sources", () => ({ leadFromHandoff: vi.fn(async () => {}) }));
vi.mock("@/core/consultant/relay", () => ({
  issueHandoffRef: vi.fn(async () => null),
  handoffRefLine: () => "",
}));

const engine = {
  paused: false,
  result: null as unknown,
};
const pauseConsultant = vi.fn(async () => {});
const runConsultant = vi.fn(async () => engine.result);
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => true,
  guardShopOrderReply: (reply: string) => reply,
  isPaused: () => engine.paused,
  pauseConsultant,
  runConsultant,
}));

const { handleZernioMessage } = await import("./handle-message");

let db: FakeDb;
let ctx: TenantContext;
beforeEach(() => {
  db = fakeDb({ unique: { consultant_message_runs: [["bot_id", "message_id"]] } });
  db.tables.app_settings = [];
  db.tables.consultant_message_runs = [];
  ctx = {
    tenant: {
      id: "b",
      vertical: "consultant",
      status: "active",
      modules: { instagram: true },
      settings: {},
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  engine.paused = false;
  engine.result = null;
  notifyAdminsHtml.mockClear();
  runConsultant.mockClear();
});

const payload = (text: string) =>
  ({
    account: { platform: "instagram", accountId: "acc-1" },
    conversation: { id: "conv-1" },
    message: { text, platformMessageId: "mid-1", sender: { id: "1" } },
  }) as never;

function transport(ok: boolean, tail: unknown[] = []) {
  const send = vi.fn(async () => (ok ? { ok: true } : { ok: false, error: "timeout" }));
  return { send, t: { send, tail: async () => tail } as unknown as ZernioTransport };
}
const usage = { inputTokens: 1, outputTokens: 1, usd: 0.001 };
const runs = () => db.tables.consultant_message_runs!;

describe("ответ консультанта не подтверждён каналом", () => {
  it("без передачи — продавцу «ответ не ушёл» с вопросом и ответом, повтора нет, паузы нет", async () => {
    engine.result = { reply: "Полотенца есть, 9 000 ₸.", handoff: null, usage };
    const { send, t } = transport(false);
    const r = await handleZernioMessage(ctx, payload("Есть полотенца?"), t);
    expect(r.status).toBe("failed");
    // Отправка могла дойти — второй попытки нет.
    expect(send).toHaveBeenCalledOnce();
    expect(pauseConsultant).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    const html = notifyAdminsHtml.mock.calls[0]![1];
    expect(html).toContain("Ответ консультанта не ушёл покупателю");
    expect(html).toContain("Есть полотенца?");
    expect(html).toContain("Полотенца есть, 9 000 ₸.");
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ status: "terminal_failed", error_code: "send_failed" });
  });

  it("с передачей — карточка менеджеру с пометкой, что фраза покупателю не ушла", async () => {
    engine.result = {
      reply: "Передаю менеджеру.",
      handoff: { kind: "handoff", reason: "human_requested", summary: "Просит человека" },
      usage,
    };
    const { send, t } = transport(false);
    await handleZernioMessage(ctx, payload("Позовите менеджера, пожалуйста"), t);
    expect(send).toHaveBeenCalledOnce();
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    const html = notifyAdminsHtml.mock.calls[0]![1];
    expect(html).toContain("Ответ консультанта не ушёл покупателю");
    expect(html).toContain("Клиент ждёт менеджера");
    expect(html).toContain("Просит человека");
  });

  it("продавец с английской админкой — пометка по-английски", async () => {
    db.tables.app_settings!.push({ key: "admin_locale", value: "en" });
    engine.result = { reply: "Есть.", handoff: null, usage };
    await handleZernioMessage(ctx, payload("Есть полотенца?"), transport(false).t);
    expect(notifyAdminsHtml.mock.calls[0]![1]).toContain(
      "The consultant's reply did not reach the customer",
    );
  });

  it("ответ ушёл — продавцу ничего, строка replied", async () => {
    engine.result = { reply: "Есть.", handoff: null, usage };
    await handleZernioMessage(ctx, payload("Есть полотенца?"), transport(true).t);
    expect(notifyAdminsHtml).not.toHaveBeenCalled();
    expect(runs()[0]).toMatchObject({ status: "replied", reply_text: "Есть." });
  });
});

describe("журнал ответов: ход без ответа", () => {
  it("консультант на паузе — строка cancelled (для сводки «отвечал менеджер»)", async () => {
    engine.paused = true;
    const { send, t } = transport(true);
    await handleZernioMessage(ctx, payload("Ещё вопрос"), t);
    expect(runConsultant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({
      status: "cancelled",
      reply_kind: "paused",
      message_id: "mid-1",
      incoming_text: "Ещё вопрос",
      sent_at: null,
    });
  });

  it("менеджер ответил из приложения — пауза и строка cancelled", async () => {
    const tail = [
      {
        direction: "outgoing",
        message: "Сейчас подскажу",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    await handleZernioMessage(ctx, payload("а размер?"), transport(true, tail).t);
    expect(pauseConsultant).toHaveBeenCalled();
    expect(runs()[0]).toMatchObject({ status: "cancelled", reply_kind: "manager" });
  });

  it("повтор доставки того же сообщения не плодит строк", async () => {
    engine.paused = true;
    await handleZernioMessage(ctx, payload("Ещё вопрос"), transport(true).t);
    await handleZernioMessage(ctx, payload("Ещё вопрос"), transport(true).t);
    expect(runs()).toHaveLength(1);
  });
});

describe("сообщение без своего ответа (core/consultant/burst)", () => {
  it("вошло в соседний ход — покупателю ничего не уходит, строка cancelled «folded»", async () => {
    engine.result = { reply: "", handoff: null, usage, skipped: "folded" };
    const { send, t } = transport(true);
    const r = await handleZernioMessage(ctx, payload("А белые?"), t);
    expect(r.status).toBe("processed");
    expect(send).not.toHaveBeenCalled();
    expect(notifyAdminsHtml).not.toHaveBeenCalled();
    expect(runs()[0]).toMatchObject({ status: "cancelled", reply_kind: "folded", sent_at: null });
  });

  it("время сообщения и его id уходят консультанту — для проверки опоздания и очереди", async () => {
    engine.result = { reply: "", handoff: null, usage, skipped: "stale" };
    const sentAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    const p = payload("Есть полотенца?") as unknown as { message: Record<string, unknown> };
    p.message.sentAt = sentAt;
    const { send, t } = transport(true);
    await handleZernioMessage(ctx, p as never, t);
    expect((runConsultant.mock.calls[0] as unknown[])[3]).toMatchObject({
      sentAt,
      messageId: "mid-1",
    });
    expect(send).not.toHaveBeenCalled();
    expect(runs()[0]).toMatchObject({ status: "cancelled", reply_kind: "stale" });
  });
});

describe("фото и видео товара консультанта", () => {
  it("текст ответа уходит первым, а фото отправляется следом", async () => {
    engine.result = {
      reply: "Вот фото комплекта.",
      handoff: null,
      usage,
      attachments: [{ url: "https://app.test/img/1.jpg", kind: "image" }],
    };
    const calls: Array<{ text: string; opts?: Record<string, unknown> }> = [];
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string, opts?: Record<string, unknown>) => {
        calls.push({ text, opts });
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;
    const r = await handleZernioMessage(ctx, payload("А фото есть?"), t);
    expect(r.status).toBe("processed");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      text: "Вот фото комплекта.",
      opts: {
        platform: "instagram",
      },
    });
    expect(calls[1]).toEqual({
      text: "",
      opts: {
        platform: "instagram",
        attachmentUrl: "https://app.test/img/1.jpg",
        attachmentType: "image",
      },
    });
  });

  it("если канал отклонил фото — ответ текстом уже ушёл, статус успешен", async () => {
    engine.result = {
      reply: "Вот фото комплекта.",
      handoff: null,
      usage,
      attachments: [{ url: "https://app.test/img/1.jpg", kind: "image" }],
    };
    const calls: Array<{ text: string; opts?: Record<string, unknown> }> = [];
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string, opts?: Record<string, unknown>) => {
        calls.push({ text, opts });
        if (opts?.attachmentUrl) {
          return {
            ok: false,
            error: "Attachments are not supported",
            failure: { status: 400, code: "PLATFORM_LIMITATION" },
          };
        }
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;
    const r = await handleZernioMessage(ctx, payload("А фото есть?"), t);
    expect(r.status).toBe("processed");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.text).toBe("Вот фото комплекта.");
    expect(calls[0]!.opts?.attachmentUrl).toBeUndefined();
    expect(calls[1]!.opts?.attachmentUrl).toBe("https://app.test/img/1.jpg");
    expect(runs()[0]).toMatchObject({ reply_text: "Вот фото комплекта." });
    expect(runs()[0]!.error_code).toBeNull();
  });

  it("orderAction от консультанта — товар оформляется и присылает сообщение с оплатой", async () => {
    ctx.tenant.modules = { ...ctx.tenant.modules, whatsapp: true, wa_shop: true } as never;
    db.tables.products = [
      {
        id: "p-ladder",
        bot_id: "b",
        name: 'Лестницы "Части речи и члены предложения"',
        price: 100,
        currency: "KZT",
        is_active: true,
        sort_order: 1,
        fulfillment_kind: "digital",
        file_path: "materials/ladder.pdf",
        product_variants: [],
      },
    ];
    db.tables.payment_methods = [
      {
        bot_id: "b",
        country_code: "KZ",
        country_name: "Казахстан",
        currency: "KZT",
        is_active: true,
        sort_order: 1,
        instructions: "Kaspi Pay: https://pay.kaspi.kz/pay/test",
      },
    ];
    db.tables.orders = [];
    db.tables.order_items = [];
    db.tables.cart_items = [];
    let cart = db.tables.cart_items;
    Object.defineProperty(db.tables, "cart_items", {
      configurable: true,
      enumerable: true,
      get() {
        for (const c of cart ?? []) {
          if (c.products) continue;
          c.products = db.tables.products?.find((p) => p.id === c.product_id) ?? null;
          c.product_variants = null;
        }
        return cart;
      },
      set(v) {
        cart = v;
      },
    });
    let orders = db.tables.orders;
    Object.defineProperty(db.tables, "orders", {
      configurable: true,
      enumerable: true,
      get() {
        for (const o of orders ?? []) {
          const items = (db.tables.order_items ?? []).filter((i) => i.order_id === o.id);
          if (items.length) o.order_items = items;
        }
        return orders;
      },
      set(v) {
        orders = v;
      },
    });
    const origRpc = db.rpc.bind(db);
    db.rpc = ((name: string, args: Record<string, unknown>) =>
      name === "claim_order_placement"
        ? { data: true, error: null }
        : origRpc(name, args)) as never;

    engine.result = {
      reply: "Отлично, оформляю «Лестницы»! Счёт на оплату формируется...",
      handoff: null,
      orderAction: { productName: "Лестницы Части речи и члены предложения" },
      usage,
    };

    const sentTexts: string[] = [];
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string) => {
        sentTexts.push(text);
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;

    const waPayload = {
      account: { platform: "whatsapp", accountId: "acc-1" },
      conversation: { id: "conv-1" },
      message: {
        text: "Да. Давайте оформим",
        platformMessageId: "mid-wa-1",
        sender: { id: "77772928100", phone: "+77772928100", name: "Турки" },
      },
    } as never;

    setEnvForTests({});
    const r = await handleZernioMessage(ctx, waPayload, t);
    expect(r.status).toBe("processed");
    expect(r.note).toBe("ответ консультанта + заказ");

    // 1-е сообщение — дружелюбный ответ консультанта
    expect(sentTexts[0]).toContain("Отлично, оформляю «Лестницы»!");
    // 2-е сообщение — счёт на оплату в Kaspi
    expect(sentTexts.some((txt) => txt.includes("Заказ") && txt.includes("100 ₸"))).toBe(true);
  });

  it("orderAction с вариантом (например, «5 класс») — оформляет конкретный вариант товара", async () => {
    ctx.tenant.modules = { ...ctx.tenant.modules, whatsapp: true, wa_shop: true } as never;
    db.tables.products = [
      {
        id: "p-ladder",
        bot_id: "b",
        name: "Лестницы Части речи и члены предложения",
        price: 2500,
        currency: "KZT",
        is_active: true,
        sort_order: 1,
        fulfillment_kind: "digital",
        file_path: "materials/ladder.pdf",
        product_variants: [
          {
            id: "v-5",
            product_id: "p-ladder",
            name: "5 класс",
            price: 2500,
            sort_order: 1,
            is_active: true,
            file_path: "materials/ladder-5.pdf",
          },
          {
            id: "v-6",
            product_id: "p-ladder",
            name: "6 класс",
            price: 2500,
            sort_order: 2,
            is_active: true,
            file_path: "materials/ladder-6.pdf",
          },
        ],
      },
    ];
    db.tables.product_variants = [
      {
        id: "v-5",
        product_id: "p-ladder",
        name: "5 класс",
        price: 2500,
        sort_order: 1,
        is_active: true,
        file_path: "materials/ladder-5.pdf",
      },
      {
        id: "v-6",
        product_id: "p-ladder",
        name: "6 класс",
        price: 2500,
        sort_order: 2,
        is_active: true,
        file_path: "materials/ladder-6.pdf",
      },
    ];
    db.tables.payment_methods = [
      {
        bot_id: "b",
        country_code: "KZ",
        country_name: "Казахстан",
        currency: "KZT",
        is_active: true,
        sort_order: 1,
        instructions: "Kaspi Pay: https://pay.kaspi.kz/pay/test",
      },
    ];
    db.tables.orders = [];
    db.tables.order_items = [];
    db.tables.cart_items = [];
    let cart = db.tables.cart_items;
    Object.defineProperty(db.tables, "cart_items", {
      configurable: true,
      enumerable: true,
      get() {
        for (const c of cart ?? []) {
          if (c.products) continue;
          c.products = db.tables.products?.find((p) => p.id === c.product_id) ?? null;
          c.product_variants =
            (
              (c.products as { product_variants?: Array<{ id: string }> })?.product_variants ?? []
            ).find((v: { id: string }) => v.id === c.variant_id) ?? null;
        }
        return cart;
      },
      set(v) {
        cart = v;
      },
    });
    let orders = db.tables.orders;
    Object.defineProperty(db.tables, "orders", {
      configurable: true,
      enumerable: true,
      get() {
        for (const o of orders ?? []) {
          const items = (db.tables.order_items ?? []).filter((i) => i.order_id === o.id);
          if (items.length) o.order_items = items;
        }
        return orders;
      },
      set(v) {
        orders = v;
      },
    });
    const origRpc = db.rpc.bind(db);
    db.rpc = ((name: string, args: Record<string, unknown>) =>
      name === "claim_order_placement"
        ? { data: true, error: null }
        : origRpc(name, args)) as never;

    engine.result = {
      reply: "Отлично, оформляю «Лестницы» за 5 класс! Счёт на оплату формируется...",
      handoff: null,
      orderAction: { productName: "Лестницы", variantName: "5 класс" },
      usage,
    };

    const sentTexts: string[] = [];
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string) => {
        sentTexts.push(text);
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;

    const waPayload = {
      account: { platform: "whatsapp", accountId: "acc-1" },
      conversation: { id: "conv-1" },
      message: {
        text: "Давайте 5 класс",
        platformMessageId: "mid-wa-2",
        sender: { id: "77772928100", phone: "+77772928100", name: "Турки" },
      },
    } as never;

    setEnvForTests({});
    const r = await handleZernioMessage(ctx, waPayload, t);
    expect(r.status).toBe("processed");
    expect(r.note).toBe("ответ консультанта + заказ");

    expect(sentTexts[0]).toContain("Отлично, оформляю «Лестницы» за 5 класс!");
    expect(
      sentTexts.some(
        (txt) => txt.includes("Заказ") && txt.includes("Лестницы") && txt.includes("2500 ₸"),
      ),
    ).toBe(true);
    expect(db.tables.order_items![0]!.product_variant_id).toBe("v-5");
  });
});
