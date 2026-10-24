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

const { runConsultant, isPaused, buildConsultantMessages, confirmedOrderIntent, KEYS } =
  await import("./engine.server");
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

  it("явное намерение: наличие и оплата не согласие; «да» работает после вопроса об оформлении", () => {
    expect(confirmedOrderIntent("Здравствуйте. У вас есть папка?", [])).toBe(false);
    expect(confirmedOrderIntent("Оплата картой", [])).toBe(false);
    expect(
      confirmedOrderIntent("Да", [{ role: "assistant", text: "Какая папка вам нужна?" }]),
    ).toBe(false);
    expect(confirmedOrderIntent("Да", [{ role: "assistant", text: "Оформляем заказ?" }])).toBe(
      true,
    );
    expect(confirmedOrderIntent("Да, давайте оформим", [])).toBe(true);
  });

  it("не создаёт orderAction, даже если модель нарушила запрет и вызвала инструмент без согласия", async () => {
    content = [
      tool("order_product", { product_name: "Папка МО классных руководителей" }),
      text("Оформляю заказ — детали и оплата сейчас появятся в этом чате."),
    ];
    const c = customer({
      consultant: {
        recent: [
          { role: "customer", text: "Мо для Казахстана" },
          { role: "assistant", text: "Вам нужна папка для России или Казахстана?" },
        ],
      },
    } as never);
    const r = await runConsultant(
      ctxOf(),
      c,
      "Здравствуйте. У вас есть папка классного руководителя?",
      { platform: "whatsapp", shopInChat: true },
    );

    expect(r?.orderAction).toBeFalsy();
    expect(args().tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "order_product" })]),
    );
    expect(r?.reply).toBe("Пока заказ не оформлен. Что именно вы хотели узнать о товаре?");
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
