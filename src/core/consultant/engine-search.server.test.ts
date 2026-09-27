import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer, DialogState } from "@/core/customers/customers";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
vi.mock("@/core/customers/customers", () => ({
  setState: vi.fn(async (_ctx: unknown, c: Customer, state: DialogState) => ({ ...c, state })),
}));

type Resp = {
  stop_reason: string;
  content: Array<Record<string, unknown>>;
  usage: { input_tokens: number; output_tokens: number };
};
/** Ответы модели по очереди: раунд за раундом; функция — побочный эффект вызова. */
let queue: Array<Resp | (() => Resp)> = [];
const create = vi.fn(async (_args: Record<string, unknown>, _opts?: Record<string, unknown>) => {
  const next = queue.shift();
  if (!next) throw new Error("очередь ответов пуста");
  return typeof next === "function" ? next() : next;
});
let aiAllowed = true;
vi.mock("./rate.server", () => ({ takeAiCall: vi.fn(async () => aiAllowed) }));
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

const { runConsultant, MAX_ROUNDS, ROUNDS_DEADLINE_MS, KEYS } = await import("./engine.server");
const { resetCatalogCache } = await import("./catalog-tool.server");
const { RESERVE_USD } = await import("./budget");

const BOT = "11111111-1111-1111-1111-111111111111";
function ctxOf(
  settings: Record<string, unknown>,
  modules: Record<string, boolean> = {},
): TenantContext {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.categories = [{ id: "c1", name: "Полотенца", bot_id: BOT }];
  db.tables.products = [
    ...Array.from({ length: 130 }, (_, i) => ({
      id: `x${i}`,
      bot_id: BOT,
      name: `Коврик ${i}`,
      description: "",
      keywords: "",
      price: 1_000 + i,
      currency: "KZT",
      stock_quantity: null,
      category_id: null,
      category_ids: [],
      country_prices: {},
      is_active: true,
      sort_order: i,
    })),
    {
      id: "t1",
      bot_id: BOT,
      name: "Полотенце Aquanova 70x140",
      description: "Махровое",
      keywords: "",
      price: 12_500,
      currency: "KZT",
      stock_quantity: null,
      category_id: null,
      category_ids: ["c1"],
      country_prices: {},
      is_active: true,
      sort_order: 999,
    },
  ];
  db.tables.product_variants = [];
  return {
    tenant: { id: BOT, name: "Магазин", settings, modules, plan: null, vertical: "digital" },
    db,
  } as unknown as TenantContext;
}
const customer = (): Customer =>
  ({
    userKey: "ig:1",
    platform: "instagram",
    telegramId: -1,
    firstName: "Аня",
    state: {},
  }) as Customer;
const usage = { input_tokens: 100, output_tokens: 10 };
const say = (t: string): Resp => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: t }],
  usage,
});
const search = (input: Record<string, unknown>, id = "s1"): Resp => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name: "search_products", input }],
  usage,
});

beforeEach(() => {
  setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
  queue = [];
  aiAllowed = true;
  resetCatalogCache();
});
afterEach(() => {
  setEnvForTests(undefined);
  create.mockClear();
});

describe("консультант с поиском по каталогу", () => {
  it("без флага — прежний режим: товары в подсказке, инструментов каталога нет", async () => {
    queue = [say("Здравствуйте")];
    await runConsultant(ctxOf({}), customer(), "привет", { platform: "instagram" });
    const args = create.mock.calls[0]![0] as { tools: Array<{ name: string }> };
    expect(args.tools.map((t) => t.name)).not.toContain("search_products");
  });

  it("находит товар за пределами первых 120 и называет его цену", async () => {
    queue = [
      search({ query: "полотенце", size: "140x70" }),
      say("Полотенце Aquanova 70x140 — 12500 KZT, в наличии."),
    ];
    const r = await runConsultant(
      ctxOf({ consultant_search: true }),
      customer(),
      "полотенце 140 на 70",
      {
        platform: "instagram",
      },
    );
    expect(r?.reply).toBe("Полотенце Aquanova 70x140 — 12500 KZT, в наличии.");
    expect(r?.handoff).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);

    const first = create.mock.calls[0]![0] as { system: Array<{ text: string }> };
    expect(first.system[0]!.text).toContain("АССОРТИМЕНТ");
    expect(first.system[0]!.text).toContain("- Полотенца: 1 поз., от 12500 KZT");
    expect(first.system[0]!.text).not.toContain("Коврик 5:");

    const second = create.mock.calls[1]![0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResult = second.messages.at(-1)!.content as Array<{ content: string }>;
    const parsed = JSON.parse(toolResult[0]!.content) as {
      items: Array<{ name: string; price: string }>;
    };
    expect(parsed.items).toEqual([
      expect.objectContaining({ name: "Полотенце Aquanova 70x140", price: "12500 KZT" }),
    ]);
  });

  it("стоимость — сумма всех раундов", async () => {
    queue = [search({ query: "полотенце" }), say("Есть полотенце Aquanova.")];
    const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "полотенце", {
      platform: "instagram",
    });
    expect(r?.usage).toMatchObject({ inputTokens: 200, outputTokens: 20 });
  });

  it("цена, которой не было в найденном, не уходит покупателю", async () => {
    queue = [search({ query: "полотенце" }), say("Полотенце стоит 9900 ₸.")];
    const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "полотенце", {
      platform: "instagram",
    });
    expect(r?.reply).not.toContain("9900");
    expect(r?.handoff?.kind).toBe("handoff");
  });

  it("раундов не больше предела, последний — без инструментов", async () => {
    queue = [
      ...Array.from({ length: MAX_ROUNDS - 1 }, (_, i) => search({ query: "плед" }, `s${i}`)),
      say("Пледов сейчас нет."),
    ];
    const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "плед", {
      platform: "instagram",
    });
    expect(r?.reply).toBe("Пледов сейчас нет.");
    expect(create).toHaveBeenCalledTimes(MAX_ROUNDS);
    const last = create.mock.calls.at(-1)![0] as { tool_choice?: { type: string } };
    expect(last.tool_choice).toEqual({ type: "none" });
  });

  it("передача менеджеру завершает раунды", async () => {
    queue = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Передаю менеджеру." },
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: { reason: "human_requested", summary: "Просит человека" },
          },
        ],
        usage,
      },
    ];
    const r = await runConsultant(
      ctxOf({ consultant_search: true }),
      customer(),
      "позовите человека",
      {
        platform: "instagram",
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(r?.handoff).toMatchObject({ kind: "handoff", summary: "Просит человека" });
  });

  it("промежуточный текст раунда поиска покупателю не уходит", async () => {
    queue = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Секунду, посмотрю." },
          { type: "tool_use", id: "s1", name: "search_products", input: { query: "полотенце" } },
        ],
        usage,
      },
      say(""),
    ];
    const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "полотенце", {
      platform: "instagram",
    });
    expect(r?.reply).not.toContain("Секунду");
  });

  it("потолок времени: новый вызов не начинается, вопрос уходит менеджеру", async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    queue = [
      () => {
        clock.mockReturnValue(t0 + ROUNDS_DEADLINE_MS);
        return search({ query: "полотенце" });
      },
    ];
    try {
      const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "полотенце", {
        platform: "instagram",
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(r?.handoff).toMatchObject({ kind: "handoff", reason: "unknown_question" });
      expect(r?.reply).toContain("менеджеру");
    } finally {
      clock.mockRestore();
    }
  });

  it("каждый вызов получает таймаут по остатку до потолка", async () => {
    queue = [search({ query: "полотенце" }), say("Есть.")];
    await runConsultant(ctxOf({ consultant_search: true }), customer(), "полотенце", {
      platform: "instagram",
    });
    for (const call of create.mock.calls) {
      const opts = call[1] as { timeout: number; maxRetries: number; signal: AbortSignal };
      expect(opts.timeout).toBeLessThanOrEqual(ROUNDS_DEADLINE_MS);
      expect(opts.maxRetries).toBe(0);
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("лимит частоты вызовов ИИ — модель не зовут, вопрос менеджеру", async () => {
    aiAllowed = false;
    const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "полотенце", {
      platform: "instagram",
    });
    expect(create).not.toHaveBeenCalled();
    expect(r?.handoff?.summary).toContain("лимит частоты");
  });

  it("бронь — на все раунды; сбой во втором раунде закрывает её прошедшими раундами", async () => {
    queue = [search({ query: "полотенце" })];
    const ctx = ctxOf({ consultant_search: true });
    const r = await runConsultant(ctx, customer(), "полотенце", { platform: "instagram" });
    expect(r?.handoff?.summary).toContain("Сбой консультанта");
    const rows = (ctx.db as unknown as { tables: Record<string, Array<Record<string, string>>> })
      .tables.app_settings!;
    const daily = JSON.parse(rows.find((x) => x.key === KEYS.daily)!.value!) as { usd: number };
    const round1 = (100 * 1 + 10 * 5) / 1_000_000;
    expect(daily.usd).toBeCloseTo(round1 + RESERVE_USD, 6);
    expect(daily.usd).toBeLessThan(RESERVE_USD * MAX_ROUNDS);
  });

  it("get_product отдаёт карточку, неизвестный id — found: false", async () => {
    queue = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "g1", name: "get_product", input: { product_id: "t1" } },
          { type: "tool_use", id: "g2", name: "get_product", input: { product_id: "нет" } },
        ],
        usage,
      },
      say("Махровое полотенце."),
    ];
    await runConsultant(ctxOf({ consultant_search: true }), customer(), "расскажите", {
      platform: "instagram",
    });
    const second = create.mock.calls[1]![0] as { messages: Array<{ content: unknown }> };
    const res = second.messages.at(-1)!.content as Array<{ content: string }>;
    expect(JSON.parse(res[0]!.content)).toMatchObject({
      found: true,
      product: { name: "Полотенце Aquanova 70x140", description: "Махровое" },
    });
    expect(JSON.parse(res[1]!.content)).toEqual({ found: false });
  });

  it("кривой ввод и неизвестный инструмент не роняют ответ", async () => {
    queue = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "s1", name: "search_products", input: { max_price: "дёшево" } },
          { type: "tool_use", id: "x1", name: "drop_tables", input: {} },
        ],
        usage,
      },
      say("Уточните, что ищете."),
    ];
    const r = await runConsultant(ctxOf({ consultant_search: true }), customer(), "что-нибудь", {
      platform: "instagram",
    });
    expect(r?.reply).toBe("Уточните, что ищете.");
    expect(r?.handoff).toBeNull();
  });

  it("цены в карте, бюджете и карточках — с акцией, как на витрине", async () => {
    const ctx = ctxOf({ consultant_search: true }, { limited_offers: true });
    const rows = (ctx.db as unknown as { tables: Record<string, unknown[]> }).tables;
    rows.app_settings!.push({
      bot_id: BOT,
      key: "limited_offers",
      value: JSON.stringify([
        {
          id: "o1",
          product_id: "t1",
          percent: 20,
          starts_at: "2020-01-01T00:00:00Z",
          ends_at: "2099-01-01T00:00:00Z",
          limit: null,
        },
      ]),
    });
    queue = [search({ query: "полотенце", max_price: 10_000 }), say("Полотенце — 10000 KZT.")];
    const r = await runConsultant(ctx, customer(), "полотенце до 10 000", {
      platform: "instagram",
    });
    const first = create.mock.calls[0]![0] as { system: Array<{ text: string }> };
    expect(first.system[0]!.text).toContain("- Полотенца: 1 поз., от 10000 KZT");
    const second = create.mock.calls[1]![0] as { messages: Array<{ content: unknown }> };
    const res = second.messages.at(-1)!.content as Array<{ content: string }>;
    expect(JSON.parse(res[0]!.content).items[0]).toMatchObject({ price: "10000 KZT" });
    expect(r?.reply).toBe("Полотенце — 10000 KZT.");
  });

  it("остаток в поиске — только при учёте остатков, как в карточке", async () => {
    const ctx = ctxOf({ consultant_search: true });
    const t1 = (
      ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> }
    ).tables.products!.find((p) => p.id === "t1")!;
    t1.stock_quantity = 0;
    queue = [search({ query: "полотенце" }), say("Есть.")];
    await runConsultant(ctx, customer(), "полотенце", { platform: "instagram" });
    const second = create.mock.calls[1]![0] as { messages: Array<{ content: unknown }> };
    const res = second.messages.at(-1)!.content as Array<{ content: string }>;
    expect(JSON.parse(res[0]!.content).items[0]).toMatchObject({ in_stock: true });
  });

  it("сбой чтения каталога — вопрос менеджеру, модель не зовут", async () => {
    const ctx = ctxOf({ consultant_search: true });
    const spy = vi
      .spyOn(await import("@/core/catalog/active"), "allActiveProducts")
      .mockRejectedValueOnce(new Error("база недоступна"));
    const r = await runConsultant(ctx, customer(), "полотенце", { platform: "instagram" });
    spy.mockRestore();
    expect(create).not.toHaveBeenCalled();
    expect(r?.handoff?.summary).toContain("Сбой чтения каталога");
  });

  it("сбой записи состояния после ответа: ответ уходит, расход и бронь — один раз", async () => {
    const { setState } = await import("@/core/customers/customers");
    vi.mocked(setState).mockRejectedValueOnce(new Error("гонка обновления"));
    queue = [search({ query: "полотенце" }), say("Есть полотенце Aquanova.")];
    const ctx = ctxOf({ consultant_search: true });
    const r = await runConsultant(ctx, customer(), "полотенце", { platform: "instagram" });
    expect(r?.reply).toBe("Есть полотенце Aquanova.");
    expect(r?.handoff).toBeNull();
    const rows = (ctx.db as unknown as { tables: Record<string, Array<Record<string, string>>> })
      .tables.app_settings!;
    const daily = JSON.parse(rows.find((x) => x.key === KEYS.daily)!.value!) as { usd: number };
    const usage = JSON.parse(rows.find((x) => x.key === KEYS.usage)!.value!) as { count: number };
    expect(daily.usd).toBeCloseTo((2 * (100 * 1 + 10 * 5)) / 1_000_000, 6);
    expect(usage.count).toBe(1);
  });
});
