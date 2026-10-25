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
const getCustomer = vi.fn(async () => customer);
const setCustomerState = vi.fn(async (_ctx: unknown, c: Customer, state: Customer["state"]) => {
  c.state = state;
  return c;
});

vi.mock("@/core/customers/customers", () => ({
  upsertCustomer: vi.fn(async () => customer),
  isBlocked: vi.fn(async () => false),
  getCustomer,
  setState: setCustomerState,
  // Условная запись раздела состояния — по снимку в памяти теста.
  claimStateSection: vi.fn(
    async (
      _ctx: unknown,
      c: Customer,
      key: string,
      patch: (cur: Record<string, unknown>) => Record<string, unknown> | null,
    ) => {
      const state = c.state as Record<string, unknown>;
      const next = patch((state[key] as Record<string, unknown>) ?? {});
      if (next === null) return null;
      c.state = { ...state, [key]: next } as Customer["state"];
      return c;
    },
  ),
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
      features: { express: true, cart: true, checkout: true, catalog: true, buy_button: true },
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
const replaceLastConsultantReply = vi.fn(async () => {});
const runConsultant = vi.fn(async () => engine.result);
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => true,
  guardShopOrderReply: (reply: string) => reply,
  isPaused: () => engine.paused,
  pauseConsultant,
  replaceLastConsultantReply,
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
  customer.state = { consultant: {} };
  notifyAdminsHtml.mockClear();
  pauseConsultant.mockClear();
  replaceLastConsultantReply.mockClear();
  runConsultant.mockClear();
  getCustomer.mockClear();
  setCustomerState.mockClear();
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

describe("сброс платёжного шага после AI-отмены", () => {
  it("очищает активный заказ только после системного подтверждения отмены", async () => {
    ctx.tenant.modules.dm_shop = true;
    customer.state = {
      mode: "awaiting_payment",
      pending_order_id: 7,
      pending_display_no: 270,
      consultant: {},
    };
    engine.result = {
      reply: "Заказ №270 отменён.",
      handoff: null,
      verifiedOrderStatus: true,
      cancelledOrderId: 7,
      usage,
    };

    await handleZernioMessage(ctx, payload("Отмени заказ 270"), transport(true).t);

    expect(getCustomer).toHaveBeenCalledWith(ctx, customer.userKey);
    expect(setCustomerState).toHaveBeenCalledOnce();
    expect(customer.state).toMatchObject({ mode: "idle" });
    expect(customer.state.pending_order_id).toBeUndefined();
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
  it("сначала подтверждает отправку фото и только потом отправляет ответ модели", async () => {
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
      text: "",
      opts: {
        platform: "instagram",
        attachmentUrl: "https://app.test/img/1.jpg",
        attachmentType: "image",
      },
    });
    expect(calls[1]).toEqual({
      text: "Вот фото комплекта.",
      opts: {
        platform: "instagram",
      },
    });
    expect(runs()[0]).toMatchObject({ status: "replied", reply_text: "Вот фото комплекта." });
  });

  it("если Instagram отклонил фото — не утверждает доставку и передаёт запрос менеджеру", async () => {
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
    expect(calls[0]!.opts?.attachmentUrl).toBe("https://app.test/img/1.jpg");
    expect(calls[1]!.text).toContain("Не удалось подтвердить отправку фото");
    expect(calls[1]!.text).not.toContain("Вот фото комплекта");
    expect(pauseConsultant).toHaveBeenCalled();
    expect(replaceLastConsultantReply).toHaveBeenCalledWith(
      ctx,
      customer,
      ["Вот фото комплекта.", "Вот фото комплекта."],
      expect.stringContaining("Не удалось подтвердить отправку фото"),
    );
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    expect(runs()[0]).toMatchObject({
      status: "terminal_failed",
      error_code: "media_send_failed",
      reply_kind: "handoff:photo",
    });
    expect(runs()[0]!.reply_text).toContain("Не удалось подтвердить отправку фото");
  });

  it("видео передаётся Instagram как video attachment", async () => {
    engine.result = {
      reply: "Вот видео.",
      handoff: null,
      usage,
      attachments: [{ url: "https://app.test/api/img/b/video.mp4", kind: "video" }],
    };
    const calls: Array<{ text: string; opts?: Record<string, unknown> }> = [];
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string, opts?: Record<string, unknown>) => {
        calls.push({ text, opts });
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;
    await handleZernioMessage(ctx, payload("Покажите видео"), t);
    expect(calls[0]!.opts).toMatchObject({
      platform: "instagram",
      attachmentUrl: "https://app.test/api/img/b/video.mp4",
      attachmentType: "video",
    });
    expect(calls[1]!.text).toBe("Вот видео.");
  });

  it("после неоднозначного 500 не объявляет фото потерянными и не повторяет отправку автоматически", async () => {
    engine.result = {
      reply: "Отправила оба фото.",
      handoff: null,
      usage,
      attachments: [
        { url: "https://app.test/img/1.jpg", kind: "image" },
        { url: "https://app.test/img/2.jpg", kind: "image" },
      ],
    };
    const calls: Array<{ text: string; opts?: Record<string, unknown> }> = [];
    let attachmentNo = 0;
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string, opts?: Record<string, unknown>) => {
        calls.push({ text, opts });
        if (opts?.attachmentUrl && ++attachmentNo === 2)
          return { ok: false, error: "Zernio API 500", failure: { status: 500 } };
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;

    await handleZernioMessage(ctx, payload("А фото есть?"), t);

    expect(calls).toHaveLength(3);
    expect(calls[2]!.text).toContain("могло уже появиться выше");
    expect(calls[2]!.text).toContain("проверьте чат");
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    expect(runs()[0]).toMatchObject({
      status: "terminal_failed",
      error_code: "media_send_ambiguous",
      reply_kind: "handoff:photo",
    });
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

describe("кнопка «Купить» под ответом консультанта (Копилка 21–25.10)", () => {
  const PID = "11111111-1111-4111-8111-111111111111";
  const V5 = "22222222-2222-4222-8222-222222222222";
  const V6 = "33333333-3333-4333-8333-333333333333";

  function shop(variants: boolean) {
    ctx.tenant.modules = { ...ctx.tenant.modules, whatsapp: true, wa_shop: true } as never;
    const vs = variants
      ? [
          { id: V5, product_id: PID, name: "5 класс", price: 2500, sort_order: 1, is_active: true },
          { id: V6, product_id: PID, name: "6 класс", price: 2500, sort_order: 2, is_active: true },
        ]
      : [];
    db.tables.products = [
      {
        id: PID,
        bot_id: "b",
        name: "Формативное оценивание",
        price: 2500,
        currency: "KZT",
        is_active: true,
        sort_order: 1,
        fulfillment_kind: "digital",
        file_path: "materials/f.pdf",
        product_variants: vs,
      },
    ];
    db.tables.product_variants = vs;
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
          c.product_variants = vs.find((v) => v.id === c.variant_id) ?? null;
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
  }

  function wa(text: string, id: string, metadata?: Record<string, unknown>) {
    return {
      account: { platform: "whatsapp", accountId: "acc-1" },
      conversation: { id: "conv-1" },
      ...(metadata ? { metadata } : {}),
      message: {
        text,
        platformMessageId: id,
        sender: { id: "77772928100", phone: "+77772928100", name: "Лилия" },
      },
    } as never;
  }

  function recorder() {
    const sent: { text: string; buttons?: { title: string; payload?: string }[] }[] = [];
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string, o?: { buttons?: never[] }) => {
        sent.push({ text, buttons: o?.buttons });
        return { ok: true };
      }),
      tail: async () => [],
    } as unknown as ZernioTransport;
    return { sent, t };
  }

  it("«У меня 5 класс» — цена с кнопкой «Купить» на вариант, без заказа и без «Оформляем?»", async () => {
    shop(true);
    engine.result = {
      reply: "Сборник для 5 класса — 2 500 ₸, PDF.",
      handoff: null,
      buyOffer: { productId: PID, variantId: V5 },
      usage,
    };
    const { sent, t } = recorder();
    setEnvForTests({});
    const r = await handleZernioMessage(ctx, wa("У меня 5 класс", "mid-b1"), t);
    expect(r.status).toBe("processed");
    expect((runConsultant.mock.calls[0] as unknown[])[3]).toMatchObject({ buyButton: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("Сборник для 5 класса — 2 500 ₸, PDF.");
    expect(sent[0]!.buttons).toEqual([
      { type: "postback", title: "🛒 Купить", payload: `CBUY:${PID}:${V5}` },
    ]);
    expect(db.tables.orders).toHaveLength(0);
  });

  it("товар с вариантами без выбранного варианта — ответ без кнопки", async () => {
    shop(true);
    engine.result = {
      reply: "Есть для 5–11 классов, по 2 500 ₸. Какой класс?",
      handoff: null,
      buyOffer: { productId: PID },
      usage,
    };
    const { sent, t } = recorder();
    setEnvForTests({});
    await handleZernioMessage(ctx, wa("Интересуют сборники", "mid-b2"), t);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.buttons).toBeUndefined();
  });

  it("товар не из каталога (выдуманный id) — ответ без кнопки", async () => {
    shop(false);
    engine.result = {
      reply: "Есть такой набор.",
      handoff: null,
      buyOffer: { productId: "44444444-4444-4444-8444-444444444444" },
      usage,
    };
    const { sent, t } = recorder();
    setEnvForTests({});
    await handleZernioMessage(ctx, wa("Интересует набор", "mid-b3"), t);
    expect(sent[0]!.buttons).toBeUndefined();
  });

  it("длинный ответ — текст отдельно, кнопка следующим коротким сообщением", async () => {
    shop(false);
    engine.result = { reply: "а".repeat(1200), handoff: null, buyOffer: { productId: PID }, usage };
    const { sent, t } = recorder();
    setEnvForTests({});
    await handleZernioMessage(ctx, wa("Расскажите подробнее", "mid-b4"), t);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.buttons).toBeUndefined();
    expect(sent[1]!.text).toBe("Нажмите, чтобы оформить и оплатить 👇");
    expect(sent[1]!.buttons?.[0]?.payload).toBe(`CBUY:${PID}`);
  });

  it("нажатие «Купить» — один заказ на выбранный вариант и оплата; повторное нажатие второго заказа не создаёт", async () => {
    shop(true);
    const { sent, t } = recorder();
    setEnvForTests({});
    const tap = (id: string) =>
      wa("🛒 Купить", id, { interactiveType: "button_reply", interactiveId: `CBUY:${PID}:${V5}` });
    const r = await handleZernioMessage(ctx, tap("mid-t1"), t);
    expect(r.status).toBe("processed");
    expect(runConsultant).not.toHaveBeenCalled();
    expect(db.tables.orders).toHaveLength(1);
    expect(db.tables.order_items![0]!.product_variant_id).toBe(V5);
    expect(sent.some((m) => m.text.includes("2500 ₸"))).toBe(true);
    await handleZernioMessage(ctx, tap("mid-t2"), t);
    expect(db.tables.orders).toHaveLength(1);
  });

  it("нажатие без нашего payload («0» у WhatsApp) — заказ по последней кнопке консультанта", async () => {
    shop(false);
    customer.state = { consultant: { buy_offer: { productId: PID } } };
    const { t } = recorder();
    setEnvForTests({});
    await handleZernioMessage(
      ctx,
      wa("🛒 Купить", "mid-t3", { interactiveType: "button_reply", interactiveId: "0" }),
      t,
    );
    expect(runConsultant).not.toHaveBeenCalled();
    expect(db.tables.orders).toHaveLength(1);
  });

  it("настройка выключена — консультант без кнопки, нажатие старой кнопки уходит вопросом", async () => {
    shop(false);
    const settings = await import("@/core/instagram/direct-bot-settings");
    vi.mocked(settings.loadDirectBotSettings).mockResolvedValueOnce({
      enabled: true,
      ignoreExcluded: false,
      triggers: [],
      features: {
        express: true,
        cart: true,
        checkout: true,
        catalog: true,
        search: true,
        buy_button: false,
      },
    } as never);
    engine.result = { reply: "2 500 ₸.", handoff: null, buyOffer: { productId: PID }, usage };
    const { sent, t } = recorder();
    setEnvForTests({});
    await handleZernioMessage(ctx, wa("Цена?", "mid-b5"), t);
    expect((runConsultant.mock.calls[0] as unknown[])[3]).toMatchObject({ buyButton: false });
    expect(sent[0]!.buttons).toBeUndefined();
  });
});
