import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer, DialogState } from "@/core/customers/customers";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

/** Что записал консультант в состояние покупателя. */
const saved: DialogState[] = [];
vi.mock("@/core/customers/customers", () => ({
  updateStateSection: vi.fn(
    async (
      _ctx: unknown,
      c: Customer,
      key: "consultant",
      patch: (cur: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const state: DialogState = {
        ...c.state,
        [key]: patch((c.state[key] ?? {}) as Record<string, unknown>) as never,
      };
      saved.push(state);
      return { ...c, state };
    },
  ),
}));

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  cache_read_input_tokens?: number | null;
};
let content: Array<Record<string, unknown>> = [];
let usage: Usage = { input_tokens: 1000, output_tokens: 200 };
const create = vi.fn(async (_args: Record<string, unknown>) => ({
  stop_reason: "end_turn",
  content,
  usage,
}));
// Лимит частоты платформы (600 вызовов в минуту на экземпляр) живёт в памяти
// модуля: на весь файл тестов он бы копился и обрывал последние тесты.
vi.mock("./rate.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rate.server")>()),
  takeAiCall: async () => true,
}));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: Object.assign(
      class {
        messages = { create };
      },
      { APIError },
    ),
  };
});

const {
  runConsultant,
  isPaused,
  buildConsultantMessages,
  guardShopOrderReply,
  KEYS,
  replaceLastConsultantReply,
  loadConsultant,
} = await import("./engine.server");
const { getSetting } = await import("@/core/settings/settings");

const BOT = "11111111-1111-1111-1111-111111111111";
function ctxOf(settings: Record<string, unknown> = {}): TenantContext {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [];
  db.tables.app_settings = [];
  return {
    tenant: {
      id: BOT,
      name: "Магазин",
      settings,
      modules: {},
      plan: null,
      vertical: "digital",
    },
    // Как у настоящего контекста: дата акции в поясе магазина, а не в поясе машины с тестом.
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
}
const customer = (state: DialogState = {}): Customer =>
  ({ userKey: "ig:1", platform: "instagram", telegramId: -1, firstName: "Аня", state }) as Customer;
const text = (t: string) => ({ type: "text", text: t });
const tool = (name: string, input: Record<string, unknown>) => ({
  type: "tool_use",
  id: "t1",
  name,
  input,
});
const args = () => create.mock.calls[0]![0] as Record<string, unknown>;
const HOUR = 3600_000;

beforeEach(() => {
  setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
  content = [text("Здравствуйте! Чем помочь?")];
  usage = { input_tokens: 1000, output_tokens: 200 };
  saved.length = 0;
});
afterEach(() => {
  setEnvForTests(undefined);
  create.mockClear();
});

describe("guardShopOrderReply: честность оплаты и выдачи", () => {
  const unsupported =
    "Да, честно. Мы сразу высылаем материалы после чека. Можете сначала оплатить, а чек прислать сюда — я прослежу.";

  it("без активного заказа не обещает выдачу после чека и не просит платить заранее", () => {
    const reply = guardShopOrderReply(unsupported, "ru", {
      orderAction: false,
      handoff: null,
      hasActivePaymentOrder: false,
    });

    expect(reply).toMatch(/не отправляйте деньги или чек/iu);
    expect(reply).not.toContain("высылаем материалы");
    expect(reply).not.toContain("я прослежу");
  });

  it("с кнопкой «Купить» «нажмите, чтобы оформить заказ» уходит, «заказ оформлен» — нет", () => {
    const hint =
      "Папка — 3 500 ₸. Нажмите «Купить», чтобы оформить заказ и получить ссылку на оплату.";
    const facts = { orderAction: false, handoff: null, hasActivePaymentOrder: false };
    expect(guardShopOrderReply(hint, "ru", { ...facts, buyOffer: true })).toBe(hint);
    expect(guardShopOrderReply(hint, "ru", facts)).not.toBe(hint);
    expect(guardShopOrderReply("Ваш заказ оформлен!", "ru", { ...facts, buyOffer: true })).not.toBe(
      "Ваш заказ оформлен!",
    );
  });

  it("при активном платёжном шаге не стирает корректное объяснение процесса", () => {
    expect(
      guardShopOrderReply(unsupported, "ru", {
        orderAction: false,
        handoff: null,
        hasActivePaymentOrder: true,
      }),
    ).toBe(unsupported);
  });

  it("не просит оплатить до появления карточки заказа даже если order_action уже вызван", () => {
    const reply = guardShopOrderReply(
      "Pay first and send a receipt; I'll send the materials right away.",
      "en",
      { orderAction: true, handoff: null, hasActivePaymentOrder: false },
    );

    expect(reply).toContain("Please wait for the order confirmation");
    expect(reply).not.toContain("send the materials right away");
  });

  it("распознаёт оплату и чек в узбекской реплике", () => {
    const reply = guardShopOrderReply(
      "To‘lovdan keyin chek yuboring, materiallar darhol keladi.",
      "uz",
      { orderAction: false, handoff: null, hasActivePaymentOrder: false },
    );

    expect(reply).toContain("pul yubormang va chek jo‘natmang");
    expect(reply).not.toContain("materiallar darhol keladi");
  });

  it("при передаче менеджеру убирает неподтверждённое обещание, но сохраняет передачу", () => {
    const reply = guardShopOrderReply(unsupported, "ru", {
      orderAction: false,
      handoff: { kind: "handoff", reason: "human_requested", summary: "Вопрос об оплате" },
      hasActivePaymentOrder: false,
    });

    expect(reply).not.toContain("высылаем материалы");
    expect(reply).toMatch(/менеджер|продавц/iu);
  });

  it.each([
    ["ru", "Поняла, отменяю. Если передумаете — пишите."],
    ["kk", "Тапсырысты жойдым."],
    ["en", "I've canceled your order."],
    ["uz", "Buyurtmani bekor qildim."],
  ] as const)("не подтверждает неподтверждённую отмену в locale=%s", (locale, claim) => {
    const reply = guardShopOrderReply(claim, locale, {
      orderAction: false,
      handoff: { kind: "handoff", reason: "complaint", summary: "Просьба отменить заказ" },
      hasActivePaymentOrder: true,
    });

    expect(reply).not.toBe(claim);
    expect(reply).toMatch(/менеджер|manager|menejer/iu);
    expect(reply).toMatch(
      /статус заказа не изменён|тапсырыс күйі өзгерген жоқ|order status hasn't changed|buyurtma holati o‘zgarmadi/iu,
    );
  });

  it("без передачи менеджеру не выдумывает, что отмена выполнена", () => {
    const reply = guardShopOrderReply("Заказ отменён.", "ru", {
      orderAction: false,
      handoff: null,
      hasActivePaymentOrder: true,
    });

    expect(reply).toMatch(/не могу подтвердить изменение статуса/iu);
    expect(reply).not.toMatch(/заказ отменён/iu);
  });

  it("пропускает отмену, подтверждённую read-only проверкой заказа", () => {
    const reply = "По данным магазина, заказ №123 отменён.";
    expect(
      guardShopOrderReply(reply, "ru", {
        orderAction: false,
        handoff: null,
        hasActivePaymentOrder: false,
        verifiedOrderStatus: true,
      }),
    ).toBe(reply);
    expect(
      guardShopOrderReply(reply, "ru", {
        orderAction: false,
        handoff: null,
        hasActivePaymentOrder: false,
      }),
    ).not.toBe(reply);
  });
});

describe("проверка статуса заказа", () => {
  it("вопрос об отмене принудительно читает заказ и отвечает по данным системы", async () => {
    const ctx = ctxOf();
    const db = ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> };
    db.tables.orders = [
      {
        id: 123,
        bot_id: BOT,
        telegram_id: -1,
        order_no: 123,
        display_no: 123,
        status: "cancelled",
        created_at: "2026-10-25T08:00:00.000Z",
      },
    ];
    content = [text("Заказ не отменён.")];
    create.mockImplementationOnce(async () => ({
      stop_reason: "tool_use",
      content: [tool("get_my_order_status", {})],
      usage,
    }));
    const buyer = { ...customer(), userKey: "wa_1", platform: "whatsapp" as const };

    const result = await runConsultant(ctx, buyer, "Вы отменили заказ?", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(args().tool_choice).toEqual({ type: "tool", name: "get_my_order_status" });
    expect(args().tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "get_my_order_status" })]),
    );
    expect(result?.tools).toContain("get_my_order_status");
    expect(result?.reply).toContain("заказ №123 отменён");
    expect(result?.reply).not.toContain("не отменён");
    expect(result?.verifiedOrderStatus).toBe(true);
    expect(result?.handoff).toBeNull();
  });

  it("Sonnet 5.5 (принудительный инструмент — 400): tool_choice не шлём, без размышления через between_tools", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test", CONSULTANT_MODEL: "claude-sonnet-5-5" });
    const ctx = ctxOf();
    content = [text("Сейчас проверю.")];
    const buyer = { ...customer(), userKey: "wa_1", platform: "whatsapp" as const };
    await runConsultant(ctx, buyer, "Вы отменили заказ?", {
      platform: "whatsapp",
      shopInChat: true,
    });
    expect(args().model).toBe("claude-sonnet-5-5");
    expect(args().tool_choice).toBeUndefined();
    expect(args().thinking).toEqual({ type: "between_tools" });
    expect(args().tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "get_my_order_status" })]),
    );
  });
});

describe("отмена заказа по решению AI-консультанта", () => {
  const buyerAfterClarification = () =>
    ({
      ...customer({
        consultant: {
          recent: [
            { role: "customer", text: "Отмени" },
            { role: "assistant", text: "Какой заказ отменить?" },
          ],
        },
      }),
      userKey: "wa_1",
      platform: "whatsapp" as const,
    }) as Customer;

  function addOrder(ctx: TenantContext, status = "awaiting_payment", paidAmount = 0) {
    const db = ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> };
    db.tables.orders = [
      {
        id: 19,
        bot_id: BOT,
        telegram_id: -1,
        order_no: 18,
        display_no: 270,
        status,
        paid_amount: paidAmount,
        platform: "whatsapp",
        points_used: 0,
        points_earned: 0,
        promo_code: null,
      },
    ];
    db.tables.order_items = [];
    return db;
  }

  it("после уточнения номера ИИ вызывает инструмент и получает подтверждённую отмену", async () => {
    const ctx = ctxOf();
    const db = addOrder(ctx);
    content = [text("Заказ №270 отменён.")];
    create.mockImplementationOnce(async () => ({
      stop_reason: "tool_use",
      content: [tool("cancel_my_order", { order_number: 270 })],
      usage,
    }));

    const result = await runConsultant(ctx, buyerAfterClarification(), "270", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(args().tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "cancel_my_order" })]),
    );
    expect(result?.tools).toContain("cancel_my_order");
    expect(result?.reply).toContain("Заказ №270 отменён");
    expect(result?.verifiedOrderStatus).toBe(true);
    expect(result?.cancelledOrderId).toBe(19);
    expect(result?.handoff).toBeNull();
    expect(db.tables.orders![0]!.status).toBe("cancelled");
  });

  it("не отменяет заказ с внесённой оплатой и не пропускает неподтверждённое обещание", async () => {
    const ctx = ctxOf();
    const db = addOrder(ctx, "awaiting_payment", 100);
    content = [text("Заказ №270 отменён.")];
    create.mockImplementationOnce(async () => ({
      stop_reason: "tool_use",
      content: [tool("cancel_my_order", { order_number: 270 })],
      usage,
    }));

    const result = await runConsultant(ctx, buyerAfterClarification(), "270", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(result?.verifiedOrderStatus).toBeUndefined();
    expect(result?.handoff).not.toBeNull();
    expect(result?.reply).toMatch(/менеджер|manager/iu);
    expect(result?.reply).toMatch(/статус заказа не изменён|order status hasn't changed/iu);
    expect(db.tables.orders![0]!.status).toBe("awaiting_payment");
  });
});

describe("консультант: ответ и состояние", () => {
  it("пустой ответ модели покупателю не уходит — вместо него уточняющий вопрос", async () => {
    content = [text("   ")];
    const r = await runConsultant(ctxOf(), customer(), "а?", { platform: "instagram" });
    expect(r?.reply).toBeTruthy();
    expect(r?.reply.trim()).not.toBe("");
    expect(r?.handoff).toBeNull();
  });

  it("paused_until в будущем — консультант молчит, в прошлом — отвечает", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(isPaused(customer({ consultant: { paused_until: at(HOUR) } } as never), now)).toBe(true);
    expect(isPaused(customer({ consultant: { paused_until: at(-HOUR) } } as never), now)).toBe(
      false,
    );
    expect(isPaused(customer({}), now)).toBe(false);
    // Мусор вместо объекта не ставит паузу.
    expect(isPaused(customer({ consultant: "x" } as never), now)).toBe(false);
  });

  it("состояние живёт в state.consultant и не ломает шаг магазина", async () => {
    const c = customer({ step: "awaiting_proof", lang: "kk" } as DialogState);
    await runConsultant(ctxOf(), c, "Есть доставка?", { platform: "instagram" });
    const st = saved.at(-1)!;
    expect(st).toMatchObject({ step: "awaiting_proof", lang: "kk" });
    const consultant = (st as { consultant: { recent: unknown[] } }).consultant;
    expect(consultant.recent).toEqual([
      { role: "customer", text: "Есть доставка?" },
      { role: "assistant", text: "Здравствуйте! Чем помочь?" },
    ]);
  });

  it("по умолчанию Sonnet 5 без рассуждений, имя можно сменить ENV", async () => {
    await runConsultant(ctxOf(), null, "привет", { platform: "telegram" });
    expect(args().model).toBe("claude-sonnet-5");
    expect(args()).toMatchObject({ thinking: { type: "disabled" } });
    create.mockClear();
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test", CONSULTANT_MODEL: "claude-haiku-4-5" });
    await runConsultant(ctxOf(), null, "привет", { platform: "telegram" });
    expect(args().model).toBe("claude-haiku-4-5");
    expect(args()).not.toHaveProperty("thinking");
  });

  it("контакт, который покупатель уже давал, попадает в данные диалога", async () => {
    await runConsultant(
      ctxOf(),
      customer({ consultant: { contact: "+7 700 000 00 00" } } as never),
      "ну что?",
      {
        platform: "instagram",
      },
    );
    const system = args().system as Array<{ text: string }>;
    expect(system[1]!.text).toContain("+7 700 000 00 00");
  });

  it("на шаге оплаты модель видит карточку оплаты этого заказа (Копилка 28.10, #274: «Выставите счёт / Халык» ушло менеджеру)", async () => {
    const card = "🧾 Заказ #274 оформлен\n🧾 «Перевод Kaspi» — оплата в Kaspi.kz и чек сюда";
    await runConsultant(
      ctxOf(),
      customer({
        mode: "choose_pay",
        pending_order_id: 4876,
        direct: { pay_card: { order: 4876, text: card } },
      } as never),
      "Выставите счет на этот номер",
      { platform: "whatsapp", shopInChat: true },
    );
    const system = args().system as Array<{ text: string }>;
    expect(system[1]!.text).toContain("Активный шаг оплаты: заказ #4876");
    expect(system[1]!.text).toContain("«Перевод Kaspi» — оплата в Kaspi.kz и чек сюда");
    expect(system[0]!.text).toContain("Вопрос о способе оплаты при активном заказе");
  });

  it("карточка другого заказа или без активного шага оплаты в данные диалога не попадает", async () => {
    await runConsultant(
      ctxOf(),
      customer({
        mode: "choose_pay",
        pending_order_id: 4877,
        direct: { pay_card: { order: 4876, text: "Заказ #274 — старая карточка" } },
      } as never),
      "Халык",
      { platform: "whatsapp", shopInChat: true },
    );
    expect((args().system as Array<{ text: string }>)[1]!.text).not.toContain("старая карточка");
    create.mockClear();
    await runConsultant(
      ctxOf(),
      customer({
        mode: "idle",
        pending_order_id: 4876,
        direct: { pay_card: { order: 4876, text: "Заказ #274 — оплачен" } },
      } as never),
      "Халык",
      { platform: "whatsapp", shopInChat: true },
    );
    expect((args().system as Array<{ text: string }>)[1]!.text).not.toContain("Заказ #274");
  });
});

describe("консультант: передача менеджеру", () => {
  it("передача менеджеру ставит паузу на 6 часов (по умолчанию, как в v1) и запоминает контакт", async () => {
    content = [
      tool("handoff_to_manager", {
        reason: "human_requested",
        customer_contact: "@anya",
        summary: "просит менеджера",
      }),
    ];
    const before = Date.now();
    const r = await runConsultant(ctxOf(), customer(), "позовите менеджера", {
      platform: "instagram",
    });
    expect(r?.handoff).toMatchObject({ kind: "handoff", customerContact: "@anya" });
    expect(r?.reply).toMatch(/менеджеру/);
    const st = (saved.at(-1) as { consultant: { paused_until: string; contact: string } })
      .consultant;
    expect(st.contact).toBe("@anya");
    const pause = Date.parse(st.paused_until) - before;
    expect(pause).toBeGreaterThanOrEqual(6 * HOUR - 1000);
    expect(pause).toBeLessThanOrEqual(6 * HOUR + 5000);
  });

  it("пауза берётся из настроек продавца: 3 часа и «пока не верну сам»", async () => {
    content = [tool("handoff_to_manager", { reason: "human_requested", summary: "менеджера" })];
    const before = Date.now();
    await runConsultant(ctxOf({ consultant_pause_hours: 3 }), customer(), "менеджера", {
      platform: "instagram",
    });
    const three = (saved.at(-1) as { consultant: { paused_until: string } }).consultant;
    const pause = Date.parse(three.paused_until) - before;
    expect(pause).toBeGreaterThanOrEqual(3 * HOUR - 1000);
    expect(pause).toBeLessThanOrEqual(3 * HOUR + 5000);

    await runConsultant(ctxOf({ consultant_pause_hours: 0 }), customer(), "менеджера", {
      platform: "instagram",
    });
    const forever = (saved.at(-1) as { consultant: { paused_until: string } }).consultant;
    expect(Date.parse(forever.paused_until) - before).toBeGreaterThan(365 * 24 * HOUR);
  });

  it("покупка — заявка продавцу и пауза", async () => {
    content = [tool("record_order_lead", { lead_type: "order", details: "2 набора" })];
    const r = await runConsultant(ctxOf(), customer(), "беру два", { platform: "instagram" });
    expect(r?.handoff).toMatchObject({ kind: "lead", summary: "2 набора" });
    expect(r?.reply).toMatch(/менеджеру/);
    const st = (saved.at(-1) as { consultant: { paused_until?: string } }).consultant;
    expect(st.paused_until).toBeTruthy();
  });

  it("«Хотела купить папку» — заказ оформляет модель, регулярка её не останавливает (Копилка 25.10)", async () => {
    content = [
      tool("order_product", { product_name: "Папка классного руководителя" }),
      text("Оформляю папку классного руководителя."),
    ];
    const c = customer({
      consultant: {
        recent: [
          { role: "customer", text: "Здравствуйте. Интересует папка классного руководителя." },
          { role: "assistant", text: "Папка классного руководителя — 3500 KZT." },
        ],
      },
    } as never);
    const r = await runConsultant(ctxOf(), c, "Хотела купить папку", {
      platform: "whatsapp",
      shopInChat: true,
    });
    expect(args().tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "order_product" })]),
    );
    expect(r?.orderAction).toMatchObject({ productName: "Папка классного руководителя" });
    expect(r?.reply).toBe("Оформляю папку классного руководителя.");
  });

  it("обещание заказа без заказа — модель переписывает ответ сама, заготовки нет", async () => {
    create.mockImplementationOnce(async () => ({
      stop_reason: "end_turn",
      content: [text("Оформляю заказ — детали и оплата сейчас появятся в этом чате.")],
      usage,
    }));
    content = [text("В папке планы, протоколы и шаблоны документов. Оформить её для вас?")];
    const r = await runConsultant(ctxOf(), customer(), "Что туда входит?", {
      platform: "whatsapp",
      shopInChat: true,
    });
    expect(r?.orderAction).toBeFalsy();
    expect(r?.reply).toBe("В папке планы, протоколы и шаблоны документов. Оформить её для вас?");
    const note = JSON.stringify(create.mock.calls.at(-1)![0]);
    expect(note).toContain("Служебное сообщение");
  });

  it("кнопка «Купить»: инструмент есть только при настройке канала, товар уходит в ответ и в состояние", async () => {
    content = [
      tool("offer_buy_button", { product_id: "p-1", variant_id: "v-5" }),
      text("Сборник для 5 класса в PDF, приходит сюда сразу."),
    ];
    const r = await runConsultant(ctxOf(), customer(), "У меня 5 класс", {
      platform: "whatsapp",
      shopInChat: true,
      buyButton: true,
    });
    expect(args().tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "offer_buy_button" })]),
    );
    expect(r?.buyOffer).toEqual({ productId: "p-1", variantId: "v-5" });
    expect(r?.reply).toBe("Сборник для 5 класса в PDF, приходит сюда сразу.");
    // Кнопка помечена временем этого ответа: напоминание шлёт её, только пока он последний.
    const st = (saved.at(-1) as { consultant: Record<string, unknown> }).consultant;
    expect(st.buy_offer).toEqual({ productId: "p-1", variantId: "v-5", at: st.last_reply_at });
    const system = args().system as { text: string }[];
    expect(system.map((b) => b.text).join("\n")).toContain("КНОПКА «КУПИТЬ»");

    content = [text("Есть.")];
    create.mockClear();
    await runConsultant(ctxOf(), customer(), "Цена?", { platform: "whatsapp", shopInChat: true });
    expect(args().tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "offer_buy_button" })]),
    );
  });

  it("не обещает заказ и оплату, если модель не вызвала order_product", async () => {
    content = [text("Оформляю заказ — детали и оплата сейчас появятся в этом чате.")];
    const r = await runConsultant(ctxOf(), customer(), "Здравствуйте. У вас есть папка?", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(r?.orderAction).toBeFalsy();
    expect(r?.reply).toBe("Пока заказ не оформлен. Что именно вы хотели узнать о товаре?");
  });

  it("в shopInChat модель не может превратить выбор товара в заявку менеджеру", async () => {
    content = [
      tool("record_order_lead", {
        lead_type: "order",
        details: "Папка МО классных руководителей для Казахстана — 2500 KZT",
      }),
      text("Спасибо, всё записал и передал менеджеру — он свяжется с вами для подтверждения."),
    ];
    const c = customer({
      consultant: {
        recent: [
          {
            role: "assistant",
            text: "Папка МО классных руководителей для Казахстана — 2500 KZT. Какая вам сейчас нужна?",
          },
        ],
      },
    } as never);
    const r = await runConsultant(ctxOf(), c, "Можно мне МО для Казахстана", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(args().tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "record_order_lead" })]),
    );
    expect(args().tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "order_product" })]),
    );
    expect(r?.handoff).toBeNull();
    expect(r?.orderAction).toBeFalsy();
    expect(r?.reply).toBe(
      "Заказ пока не оформлен и менеджеру не передан. Оформить его прямо здесь, в чате?",
    );
  });

  it("в shopInChat purchase-handoff не превращает короткий выбор товара в заявку менеджеру", async () => {
    content = [
      tool("handoff_to_manager", {
        reason: "purchase",
        summary: "Папка МО классных руководителей для Казахстана — 2500 KZT",
      }),
      text("Записываю к заказу и передаю менеджеру."),
    ];
    const c = customer({
      consultant: {
        recent: [
          {
            role: "assistant",
            text: "Папка МО классных руководителей для Казахстана — 2500 KZT. Какая папка вам нужна?",
          },
        ],
      },
    } as never);
    const r = await runConsultant(ctxOf(), c, "МО для Казахстана", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(r?.handoff).toBeNull();
    expect(r?.orderAction).toBeFalsy();
    expect(r?.reply).toMatch(/заказ пока не оформлен/iu);
    expect(r?.reply).toContain("менеджеру не передан");
  });

  it("после явного согласия ошибочный purchase-handoff восстанавливается через order_product", async () => {
    create.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        tool("handoff_to_manager", { reason: "purchase", summary: "Папка МО для Казахстана" }),
        text("Передаю менеджеру."),
      ],
      usage,
    });
    create.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        tool("order_product", { product_name: "Папка МО для Казахстана" }),
        text("Оформляю заказ — ссылка оплаты появится в чате."),
      ],
      usage,
    });
    const c = customer({
      consultant: {
        recent: [
          { role: "assistant", text: "Папка МО для Казахстана — 2500 KZT. Оформляем заказ?" },
        ],
      },
    } as never);
    const r = await runConsultant(ctxOf(), c, "Да, оформляйте", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(r?.handoff).toBeNull();
    expect(r?.orderAction?.productName).toBe("Папка МО для Казахстана");
  });

  it("контекстный выбор конкретного товара разрешает order_product без handoff", async () => {
    content = [
      tool("order_product", {
        product_name: "Папка МО классных руководителей для Казахстана",
        quantity: 1,
      }),
      text("Оформляю заказ — детали и оплата появятся в этом чате."),
    ];
    const c = customer({
      consultant: {
        recent: [
          {
            role: "assistant",
            text: "Папка МО классных руководителей для Казахстана — 2500 KZT. Какая вам сейчас нужна?",
          },
        ],
      },
    } as never);
    const r = await runConsultant(ctxOf(), c, "Можно мне МО для Казахстана", {
      platform: "whatsapp",
      shopInChat: true,
    });

    expect(r?.handoff).toBeNull();
    expect(r?.orderAction?.productName).toBe("Папка МО классных руководителей для Казахстана");
    expect(r?.reply).toContain("Оформляю заказ");
  });

  it("покупка в чате с магазином (shopInChat) — order_product возвращает orderAction без передачи менеджеру и без паузы", async () => {
    content = [
      tool("order_product", {
        product_name: "Лестницы Части речи и члены предложения",
        variant_name: "7 класс",
        quantity: "1",
      }),
      text("Отлично, оформляю «Лестницы» 7 класс! Счёт на оплату формируется..."),
    ];
    const r = await runConsultant(ctxOf(), customer(), "Да. Давайте оформим", {
      platform: "whatsapp",
      shopInChat: true,
    });
    expect(r?.handoff).toBeNull();
    expect(r?.orderAction).toEqual({
      productId: undefined,
      productName: "Лестницы Части речи и члены предложения",
      variantId: undefined,
      variantName: "7 класс",
      quantity: 1,
    });
    expect(r?.reply).toContain("Лестницы");
    const st = (saved.at(-1) as { consultant: { paused_until?: string } }).consultant;
    expect(st.paused_until).toBeUndefined();
  });
});

describe("консультант: покупка нескольких позиций", () => {
  it("order_product с items — одна покупка на все позиции, пустой текст не даёт «уточните»", async () => {
    content = [
      tool("order_product", {
        product_name: "Формативное оценивание по русскому языку",
        variant_name: "5 класс",
        items: [
          { product_name: "Формативное оценивание по русскому языку", variant_name: "6 класс" },
          { product_name: "Формативное оценивание по русскому языку", variant_name: "7 класс" },
          { quantity: 3 },
        ],
      }),
    ];
    const r = await runConsultant(ctxOf(), customer(), "Беру 5, 6 и 7 классы", {
      platform: "whatsapp",
      shopInChat: true,
    });
    expect(r?.handoff).toBeNull();
    expect(r?.orderAction?.variantName).toBe("5 класс");
    expect(r?.orderAction?.extra?.map((e) => e.variantName)).toEqual(["6 класс", "7 класс"]);
    expect(r?.reply).not.toMatch(/Уточните/);
    expect(r?.reply).toMatch(/Оформляю заказ/);
  });
});

describe("консультант: сообщения для модели", () => {
  it("история — отдельные сообщения с ролями, а не одна строка", async () => {
    const c = customer({
      consultant: {
        recent: [
          { role: "customer", text: "Есть пазлы?" },
          { role: "assistant", text: "Да, от 2000 ₸." },
        ],
      },
    } as never);
    await runConsultant(ctxOf(), c, "А доставка?", { platform: "instagram" });
    expect(args().messages).toEqual([
      { role: "user", content: "Есть пазлы?" },
      { role: "assistant", content: "Да, от 2000 ₸." },
      { role: "user", content: "А доставка?" },
    ]);
  });

  it("соседние реплики одной роли склеиваются, первой всегда идёт покупатель", () => {
    expect(
      buildConsultantMessages(
        [
          { role: "assistant", text: "Приветствие" },
          { role: "customer", text: "Здравствуйте" },
          { role: "customer", text: "Есть пазлы?" },
          { role: "assistant", text: "Есть." },
          { role: "customer", text: "" },
        ],
        "Сколько стоят?",
      ),
    ).toEqual([
      { role: "user", content: "Здравствуйте\n\nЕсть пазлы?" },
      { role: "assistant", content: "Есть." },
      { role: "user", content: "Сколько стоят?" },
    ]);
  });
});

describe("консультант: цена ответа и кеш промпта", () => {
  // Ставки ниже — Haiku 4.5: модель задана явно, не по умолчанию платформы.
  beforeEach(() =>
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test", CONSULTANT_MODEL: "claude-haiku-4-5" }),
  );
  const spent = async (ctx: TenantContext) =>
    JSON.parse((await getSetting(ctx, KEYS.usage))!) as {
      usd: number;
      inputTokens: number;
      outputTokens: number;
    };

  it("забирает поля кеша из ответа API", async () => {
    usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 3000,
    };
    const ctx = ctxOf();
    await runConsultant(ctx, null, "привет", { platform: "telegram" });
    expect((await spent(ctx)).inputTokens).toBe(5100);
  });

  it("ответ без полей кеша даёт нули, а не NaN", async () => {
    usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: null };
    const ctx = ctxOf();
    const r = await runConsultant(ctx, null, "привет", { platform: "telegram" });
    expect(Number.isNaN(r!.usage.usd)).toBe(false);
    const u = await spent(ctx);
    expect(u.inputTokens).toBe(100);
    expect(u.usd).toBeCloseTo((100 * 1 + 50 * 5) / 1e6, 9);
  });

  it("передаёт картинку покупателя в messages модели (Vision-to-Product)", async () => {
    content = [{ type: "text", text: "Вижу на фото синий комплект. Сейчас найду его в каталоге." }];
    const ctx = ctxOf();
    create.mockClear();
    await runConsultant(ctx, null, "посмотрите фото", {
      platform: "whatsapp",
      images: [{ mediaType: "image/jpeg", data: "abcd1234" }],
    });
    expect(create).toHaveBeenCalled();
    const lastCall = create.mock.calls[0]![0] as { messages: Array<{ content: unknown }> };
    const lastUserMsg = lastCall.messages[lastCall.messages.length - 1];
    expect(Array.isArray(lastUserMsg?.content)).toBe(true);
    const blocks = lastUserMsg?.content as Array<{ type: string; source?: { data: string } }>;
    expect(blocks.some((b) => b.type === "image" && b.source?.data === "abcd1234")).toBe(true);
  });

  it("кеш промпта держится час, и запись в него считается по часовой ставке", async () => {
    usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 };
    const ctx = ctxOf();
    const r = await runConsultant(ctx, null, "привет", { platform: "telegram" });
    const system = args().system as Array<{ cache_control?: { type: string; ttl?: string } }>;
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // Часовая запись — $2 за миллион (вдвое дороже входа), а не $1.25 пятиминутной.
    expect(r!.usage.usd).toBeCloseTo(2, 9);
    expect((await spent(ctx)).usd).toBeCloseTo(2, 6);
  });

  it("запись в пятиминутный кеш (хвост переписки) — по своей ставке 1,25×, остальное — часовая", async () => {
    usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 400_000, ephemeral_1h_input_tokens: 600_000 },
    };
    const ctx = ctxOf();
    const r = await runConsultant(ctx, null, "привет", { platform: "telegram" });
    // Haiku 4.5: 600 тыс. × $2 + 400 тыс. × $1,25 за миллион.
    expect(r!.usage.usd).toBeCloseTo(1.2 + 0.5, 9);
    expect((await spent(ctx)).usd).toBeCloseTo(1.7, 6);
  });

  it("Haiku 5.5: свои ставки, длинный запрос (больше 100 тыс.) — по повышенной", async () => {
    const { callUsd } = await import("./engine.server");
    expect(callUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(
      0.5,
      9,
    );
    expect(
      callUsd("claude-haiku-5-5", {
        input_tokens: 10_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 50_000,
      }),
    ).toBeCloseTo((10_000 * 0.1 + 1_000_000 * 0.5 + 50_000 * 0.01) / 1e6, 9);
    expect(
      callUsd("claude-haiku-5-5", {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 80_000,
        cache_creation: { ephemeral_5m_input_tokens: 80_000 },
      }),
    ).toBeCloseTo((80_000 * 0.125) / 1e6, 9);
  });

  it("чтение из кеша попадает в стоимость и в дневной предел", async () => {
    usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 };
    const ctx = ctxOf();
    const r = await runConsultant(ctx, null, "привет", { platform: "telegram" });
    // $0.10 за миллион токенов из кеша.
    expect(r!.usage.usd).toBeCloseTo(0.1, 9);
    const daily = JSON.parse((await getSetting(ctx, KEYS.daily))!);
    expect(daily.usd).toBeCloseTo(0.1, 6);
  });

  it("цена сообщения считается по тем же ставкам, что и общий счёт", async () => {
    usage = {
      input_tokens: 1000,
      output_tokens: 400,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 10_000,
    };
    const ctx = ctxOf();
    const r = await runConsultant(ctx, null, "привет", { platform: "telegram" });
    // Haiku 4.5: вход $1, выход $5, запись в часовой кеш $2, чтение $0.10 за миллион.
    const expected = (1000 * 1 + 400 * 5 + 2000 * 2 + 10_000 * 0.1) / 1e6;
    expect(r!.usage.usd).toBeCloseTo(expected, 9);
    expect((await spent(ctx)).usd).toBeCloseTo(expected, 6);
    expect(JSON.parse((await getSetting(ctx, KEYS.daily))!).usd).toBeCloseTo(expected, 6);
  });
});

describe("консультант: ИИ-баланс клиента", () => {
  it("баланс кончился — модель не зовём, вопрос менеджеру, дневной счёт не тронут", async () => {
    const ctx = ctxOf();
    (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.app_settings!.push({
      bot_id: BOT,
      key: "ai_balance",
      value: JSON.stringify({ usd: 0.001, low: true, empty: false }),
    });
    const r = await runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" });
    expect(create).not.toHaveBeenCalled();
    expect(r?.reply).toMatch(/менеджеру/);
    expect(r?.handoff?.summary).toMatch(/ИИ-баланс/);
    expect(JSON.parse((await getSetting(ctx, KEYS.daily))!).usd).toBe(0);
  });

  it("сбой учёта баланса — не «кончился»: модель не зовём, без паузы, дневной счёт назад", async () => {
    const ctx = ctxOf();
    (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.app_settings!.push({
      bot_id: BOT,
      key: "ai_balance",
      value: "испорчено",
    });
    const r = await runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" });
    expect(create).not.toHaveBeenCalled();
    expect(r?.handoff?.summary).toMatch(/Сбой учёта ИИ-баланса/);
    // Без паузы: записаны только очередь диалога и закрытие хода (core/consultant/burst).
    expect(saved.some((st) => st.consultant?.paused_until)).toBe(false);
    expect(JSON.parse((await getSetting(ctx, KEYS.daily))!).usd).toBe(0);
  });

  it("ответ модели списывает с баланса его цену", async () => {
    const ctx = ctxOf();
    const r = await runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" });
    const bal = JSON.parse((await getSetting(ctx, "ai_balance"))!) as { usd: number };
    expect(bal.usd).toBeCloseTo(5 - r!.usage.usd, 6);
  });
});

describe("консультант: сводка менеджеру на языке продавца", () => {
  it("сбой учёта ИИ-баланса — сводка на языке админки", async () => {
    const ctx = ctxOf();
    const tables = (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables;
    tables.app_settings!.push({ bot_id: BOT, key: "admin_locale", value: "en" });
    tables.app_settings!.push({ bot_id: BOT, key: "ai_balance", value: "испорчено" });
    const r = await runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" });
    expect(r?.handoff?.summary).toMatch(/AI balance accounting failed\. The customer wrote/);
  });
});

describe("консультант: каталог знает предзаказ и акции", () => {
  const catalogOf = async (ctx: TenantContext) => {
    await runConsultant(ctx, customer(), "Есть ли X?", { platform: "instagram" });
    return (args().system as Array<{ text: string }>).map((b) => b.text).join("\n");
  };
  const withProduct = (modules: Record<string, boolean>, stock: number) => {
    const ctx = ctxOf();
    (ctx.tenant as { modules: unknown }).modules = modules;
    (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.products!.push({
      id: "p1",
      name: "Свеча",
      price: 1000,
      is_active: true,
      sort_order: 1,
      stock_quantity: stock,
      category_ids: [],
    });
    return ctx;
  };
  const setting = (ctx: TenantContext, key: string, value: string) =>
    (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.app_settings!.push({
      bot_id: BOT,
      key,
      value,
    });
  it("нулевой остаток и предзаказ — «предзаказ с датой», а не «нет в наличии»", async () => {
    const ctx = withProduct({ stock: true }, 0);
    setting(ctx, "preorder:p1", "2099-01-15");
    const sys = await catalogOf(ctx);
    expect(sys).toContain("Свеча");
    expect(sys).toContain("предзаказ");
    expect(sys).toContain("отправка с 2099-01-15");
    expect(sys).not.toContain("нет в наличии");
  });
  it("описание товара в маленьком каталоге видно целиком, в большом — по бюджету", async () => {
    const { descriptionLimit } = await import("./engine.server");
    expect(descriptionLimit(22)).toBe(727);
    expect(descriptionLimit(1)).toBe(900);
    expect(descriptionLimit(120)).toBe(160);
    const ctx = withProduct({}, 5);
    const row = (ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> })
      .tables.products![0]!;
    // Копилка 23.10: «на какой бумаге печатать?» — ответ был в конце описания.
    row.description = `${"Яркая наглядность для кабинета. ".repeat(12)}Материал готов к печати на А4 и на А3.`;
    expect(await catalogOf(ctx)).toContain("на А4 и на А3");
  });
  it("нулевой остаток без предзаказа — по-прежнему «нет в наличии»", async () => {
    expect(await catalogOf(withProduct({ stock: true }, 0))).toContain("нет в наличии");
  });
  it("товар по акции — в каталоге процент и срок, цена со скидкой", async () => {
    const ctx = withProduct({ limited_offers: true }, 5);
    setting(
      ctx,
      "limited_offers",
      JSON.stringify([
        {
          id: "o1",
          product_id: "p1",
          percent: 30,
          starts_at: "2000-01-01T00:00:00Z",
          ends_at: "2099-01-01T00:00:00Z",
          limit: null,
        },
      ]),
    );
    const sys = await catalogOf(ctx);
    expect(sys).toContain("700");
    expect(sys).toContain("по акции −30% до 01.01");
  });
});

describe("консультант: ответы-передачи на языке покупателя", () => {
  const empty = () => {
    const ctx = ctxOf({ default_locale: "ru" });
    (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.app_settings!.push({
      bot_id: BOT,
      key: "ai_balance",
      value: JSON.stringify({ usd: 0.001, low: true, empty: false }),
    });
    return ctx;
  };
  it.each([
    ["kk", /менеджерге/],
    ["uz", /menejerga/],
    ["en", /manager/],
    ["ru", /менеджеру/],
  ] as const)("баланс кончился, покупатель на %s — ответ на его языке", async (locale, re) => {
    const r = await runConsultant(empty(), customer({ locale }), "Сколько стоит?", {
      platform: "instagram",
    });
    expect(create).not.toHaveBeenCalled();
    expect(r?.reply).toMatch(re);
  });
  it("язык не выбран — язык магазина", async () => {
    const ctx = empty();
    ctx.tenant.settings.default_locale = "kk";
    const r = await runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" });
    expect(r?.reply).toMatch(/менеджерге/);
  });
});

describe("консультант: запасные ответы на языке покупателя", () => {
  const LOCALES = ["ru", "kk", "en", "uz"] as const;
  const CYR = /[а-яёәғқңөұүһі]/i;
  const run = (
    locale: (typeof LOCALES)[number],
    reply: ReturnType<typeof text>[] | typeof content,
  ) => {
    content = reply;
    return runConsultant(ctxOf({ default_locale: "ru" }), customer({ locale }), "Сколько стоит?", {
      platform: "instagram",
    });
  };
  const replies = async (make: (l: (typeof LOCALES)[number]) => typeof content) => {
    const out: Record<string, string> = {};
    for (const l of LOCALES) out[l] = (await run(l, make(l)))!.reply;
    return out;
  };

  it("цена не из каталога: ответ заменён и написан на языке покупателя", async () => {
    const r = await replies(() => [text("Стоит 99999 тенге")]);
    expect(r.ru).toMatch(/Точную стоимость/);
    expect(r.kk).toMatch(/менеджерден/);
    expect(r.en).toMatch(/exact price/);
    expect(r.uz).toMatch(/menejerdan/);
    expect(new Set(Object.values(r)).size).toBe(4);
  });

  it("цена не из каталога: модель переписывает ответ — клиент не уходит менеджеру и не получает паузу", async () => {
    create.mockImplementationOnce(async () => ({
      stop_reason: "end_turn",
      content: [text("Стоит 99999 тенге")],
      usage,
    }));
    content = [text("Сумма набора — по каталогу, сейчас пришлю точный расчёт.")];
    const r = await runConsultant(ctxOf({ default_locale: "ru" }), customer(), "Сколько стоит?", {
      platform: "whatsapp",
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(r?.handoff).toBeNull();
    expect(r?.reply).toMatch(/точный расчёт/);
    const st = (saved.at(-1) as { consultant: { paused_until?: string } }).consultant;
    expect(st.paused_until).toBeUndefined();
  });

  it("заявка без текста от модели: подтверждение на языке покупателя", async () => {
    const r = await replies(() => [
      tool("record_order_lead", { lead_type: "order", details: "x" }),
    ]);
    expect(r.kk).toMatch(/менеджерге/);
    expect(r.en).toMatch(/manager/);
    expect(r.uz).toMatch(/menejerga/);
    expect(r.en).not.toMatch(CYR);
    expect(new Set(Object.values(r)).size).toBe(4);
  });

  it("передача менеджеру без текста и пустой ответ — тоже на языке покупателя", async () => {
    const h = await replies(() => [
      tool("handoff_to_manager", { reason: "human_requested", summary: "x" }),
    ]);
    expect(h.en).toMatch(/handing/);
    expect(h.kk).toMatch(/Диалогты/);
    expect(h.uz).toMatch(/Suhbatni/);
    const e = await replies(() => [text("  ")]);
    expect(e.en).toMatch(/what exactly/);
    expect(e.en).not.toMatch(CYR);
    expect(e.kk).toMatch(/қызықтыр/);
    expect(e.uz).toMatch(/Iltimos/);
  });
});

describe("история консультанта после сбоя доставки медиа", () => {
  it("заменяет последний сохранённый ответ на фактический текст об ошибке", async () => {
    saved.length = 0;
    const c = customer({
      consultant: {
        recent: [
          { role: "customer", text: "А фото есть?" },
          { role: "assistant", text: "Вот фото комплекта." },
        ],
      },
    } as unknown as DialogState);
    const actual = "Не удалось подтвердить отправку фото через Instagram.";
    await replaceLastConsultantReply(ctxOf(), c, ["Вот фото комплекта."], actual);
    const state = saved.at(-1) as { consultant: { recent: { role: string; text: string }[] } };
    expect(state.consultant.recent).toEqual([
      { role: "customer", text: "А фото есть?" },
      { role: "assistant", text: actual },
    ]);
  });
});

describe("консультант: счётчик ИИ-диалогов месяца", () => {
  it("два покупателя начинают диалог одновременно — в счётчике оба", async () => {
    const ctx = ctxOf();
    const other = { ...customer(), userKey: "ig:2" } as Customer;
    await Promise.all([
      runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" }),
      runConsultant(ctx, other, "Есть доставка?", { platform: "instagram" }),
    ]);
    const raw = await getSetting(ctx, "consultant_dialogs_month");
    expect(JSON.parse(raw!).count).toBe(2);
  });
});

describe("анкета консультанта", () => {
  it("пустые условия оплаты и доставки не заполняются чужими (Копилки) даже при Робокассе", async () => {
    const ctx = ctxOf();
    (ctx.tenant as { modules: Record<string, boolean> }).modules = {
      robokassa: true,
      prodamus: true,
    };
    (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables.app_settings = [
      { bot_id: BOT, key: "robokassa_enabled", value: "true" },
      { bot_id: BOT, key: "prodamus_enabled", value: "true" },
      { bot_id: BOT, key: KEYS.profile, value: JSON.stringify({ countries: ["KZ"] }) },
    ];
    const { profile } = await loadConsultant(ctx);
    expect(profile.payment_info ?? "").toBe("");
    expect(profile.delivery_info ?? "").toBe("");
    expect(profile.countries).toEqual(["KZ"]);
  });
});
