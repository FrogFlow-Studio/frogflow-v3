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

const { runConsultant, isPaused, buildConsultantMessages, KEYS } = await import("./engine.server");
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
    db,
  } as unknown as TenantContext;
}
const customer = (state: DialogState = {}): Customer =>
  ({ userKey: "ig:1", platform: "instagram", telegramId: -1, firstName: "Аня", state }) as Customer;
const text = (t: string) => ({ type: "text", text: t });
const tool = (name: string, input: Record<string, string>) => ({
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

  it("по умолчанию Haiku 4.5, имя можно сменить ENV", async () => {
    await runConsultant(ctxOf(), null, "привет", { platform: "telegram" });
    expect(args().model).toBe("claude-haiku-4-5");
    create.mockClear();
    setEnvForTests({ ANTHROPIC_API_KEY: "sk-test", CONSULTANT_MODEL: "claude-sonnet-5" });
    await runConsultant(ctxOf(), null, "привет", { platform: "telegram" });
    expect(args().model).toBe("claude-sonnet-5");
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
  it("передача менеджеру ставит паузу на 12 часов и запоминает контакт", async () => {
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
    expect(pause).toBeGreaterThanOrEqual(12 * HOUR - 1000);
    expect(pause).toBeLessThanOrEqual(12 * HOUR + 5000);
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
    expect(saved).toHaveLength(0);
    expect(JSON.parse((await getSetting(ctx, KEYS.daily))!).usd).toBe(0);
  });

  it("ответ модели списывает с баланса его цену", async () => {
    const ctx = ctxOf();
    const r = await runConsultant(ctx, customer(), "Сколько стоит?", { platform: "instagram" });
    const bal = JSON.parse((await getSetting(ctx, "ai_balance"))!) as { usd: number };
    expect(bal.usd).toBeCloseTo(5 - r!.usage.usd, 6);
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
