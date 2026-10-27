import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setAiMarkupSource } from "@/core/ai/markup";
import { aiJournal } from "@/core/ai/balance";
import { CACHE_WARM_KEY, warmPricelistCache } from "./cache-warm.server";
import { decidePricelistReply, loadPricelistData } from "./engine.server";

const BOT = "bb3ffba7-edf0-4cce-8742-ff10c9495c44";
const NOW = new Date("2026-10-27T10:00:00Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const CATALOG = [
  {
    id: "luxor-200",
    name: "BOVI КПБ LUXOR 1000 TC 200x220, цвет белый",
    category: "Постельное белье BOVI",
    size: "200x220",
    colors: ["белый"],
    price_kzt: 530000,
    stock: true,
  },
];

beforeEach(() => setEnvForTests({ ANTHROPIC_API_KEY: "test-key" }));
afterEach(() => {
  setEnvForTests(undefined);
  setAiMarkupSource(null);
});

function setup(
  opts: {
    settings?: Record<string, unknown>;
    runs?: string[];
    extra?: Record<string, string>;
  } = {},
) {
  // Как в базе: одна строка настройки на ключ магазина.
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const rows: Record<string, string> = {
    consultant_catalog_json: JSON.stringify(CATALOG),
    consultant_shop_url: "https://bovi.kz",
    ai_balance: JSON.stringify({ usd: 4.3, low: false, empty: false }),
    ...opts.extra,
  };
  db.tables.app_settings = Object.entries(rows).map(([key, value]) => ({
    bot_id: BOT,
    key,
    value,
    updated_at: minAgo(600),
  }));
  db.tables.consultant_message_runs = (opts.runs ?? []).map((at, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    bot_id: BOT,
    model: "claude-sonnet-5",
    created_at: at,
  }));
  const ctx = {
    tenant: {
      id: BOT,
      status: "active",
      vertical: "consultant",
      modules: { instagram: true },
      settings: {
        served_by: "v2",
        consultant_pricelist: { enabled: true, virtual_intro: true },
        consultant_cache_warm: true,
        ...opts.settings,
      },
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const call = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(JSON.parse(JSON.stringify(p)) as Anthropic.MessageCreateParamsNonStreaming);
    // Как ответ Anthropic при тёплом кеше: 12 тыс. токенов читаются, 1 токен вывода.
    return {
      usage: {
        input_tokens: 3,
        output_tokens: 1,
        cache_read_input_tokens: 12_000,
        cache_creation_input_tokens: 0,
      } as Anthropic.Usage,
    };
  };
  const setting = (key: string) =>
    (db.tables.app_settings ?? []).find((r) => r.key === key)?.value as string | undefined;
  return { ctx, db, calls, call, setting };
}

describe("прогрев кеша консультанта по прайсу", () => {
  it("кеш остывает (ответ был 55 мин назад): один вызов с тем же началом запроса, что у ответа покупателю", async () => {
    const { ctx, db, calls, call, setting } = setup({ runs: [minAgo(55), minAgo(300)] });
    const r = await warmPricelistCache(ctx, { call, now: NOW });
    expect(r).toMatchObject({ warmed: true, idleMin: 55 });
    expect(calls).toHaveLength(1);

    // Начало запроса совпадает с настоящим ходом консультанта — иначе кеш другой.
    const real: Array<{ system: unknown; tools: unknown; model?: string }> = [];
    await decidePricelistReply(await loadPricelistData(ctx), {
      text: "Цена?",
      state: {},
      now: NOW,
      call: async (req) => {
        real.push(JSON.parse(JSON.stringify(req)) as (typeof real)[number]);
        return "late";
      },
    });
    expect(calls[0]!.system).toEqual(real[0]!.system);
    expect(calls[0]!.tools).toEqual(real[0]!.tools);
    expect(calls[0]!.model).toBe("claude-sonnet-5");
    expect(calls[0]!.max_tokens).toBe(1);

    // Платит клиент: с ИИ-баланса списана цена вызова, в журнале — своя строка.
    const usd = (3 * 2 + 12_000 * 0.2 + 1 * 10) / 1e6;
    const bal = JSON.parse(setting("ai_balance")!) as { usd: number };
    expect(bal.usd).toBeCloseTo(4.3 - usd, 6);
    const journal = await aiJournal(ctx);
    expect(journal).toEqual([
      expect.objectContaining({
        type: "charges",
        use: "cache_warm",
        label: "Прогрев кеша консультанта",
        calls: 1,
      }),
    ]);
    expect((journal[0] as { usd: number }).usd).toBeCloseTo(usd, 6);
    expect(db.tables.consultant_message_runs).toHaveLength(2);
    expect(JSON.parse(setting(CACHE_WARM_KEY)!)).toEqual({ at: NOW.toISOString() });
  });

  it("наценка оператора 10 % ложится и на прогрев", async () => {
    setAiMarkupSource(async () => 10);
    const { ctx, call, setting } = setup({ runs: [minAgo(70)] });
    expect(await warmPricelistCache(ctx, { call, now: NOW })).toMatchObject({ warmed: true });
    const usd = ((3 * 2 + 12_000 * 0.2 + 1 * 10) / 1e6) * 1.1;
    expect((JSON.parse(setting("ai_balance")!) as { usd: number }).usd).toBeCloseTo(4.3 - usd, 6);
    const [row] = await aiJournal(ctx);
    expect((row as { usd: number }).usd).toBeCloseTo(usd, 6);
  });

  it("на балансе меньше брони — не греет и ничего не списывает", async () => {
    const { ctx, calls, call, setting } = setup({
      runs: [minAgo(70)],
      extra: { ai_balance: JSON.stringify({ usd: 0.03, low: true, empty: false }) },
    });
    expect(await warmPricelistCache(ctx, { call, now: NOW })).toEqual({
      skipped: "ИИ-баланс клиента пуст",
    });
    expect(calls).toHaveLength(0);
    expect((JSON.parse(setting("ai_balance")!) as { usd: number }).usd).toBe(0.03);
  });

  it("вызов модели упал — бронь возвращается, клиенту не в счёт", async () => {
    const { ctx, setting } = setup({ runs: [minAgo(70)] });
    const call = async () => {
      throw new Error("overloaded");
    };
    await expect(warmPricelistCache(ctx, { call, now: NOW })).rejects.toThrow("overloaded");
    expect((JSON.parse(setting("ai_balance")!) as { usd: number }).usd).toBeCloseTo(4.3, 6);
    expect(await aiJournal(ctx)).toEqual([]);
  });

  it("недавно отвечал (10 мин назад) — не греет", async () => {
    const { ctx, calls, call } = setup({ runs: [minAgo(10)] });
    expect(await warmPricelistCache(ctx, { call, now: NOW })).toEqual({
      skipped: "кеш тёплый: недавно отвечал",
    });
    expect(calls).toHaveLength(0);
  });

  it("недавно грели (10 мин назад), ответов давно не было — не греет второй раз", async () => {
    const { ctx, calls, call } = setup({
      runs: [minAgo(180)],
      extra: { [CACHE_WARM_KEY]: JSON.stringify({ at: minAgo(10) }) },
    });
    expect(await warmPricelistCache(ctx, { call, now: NOW })).toEqual({
      skipped: "кеш тёплый: недавно грели",
    });
    expect(calls).toHaveLength(0);
  });

  it("прогрев 55 мин назад и тишина — греет снова, кеш живёт дальше", async () => {
    const { ctx, calls, call } = setup({
      runs: [minAgo(600)],
      extra: { [CACHE_WARM_KEY]: JSON.stringify({ at: minAgo(55) }) },
    });
    expect(await warmPricelistCache(ctx, { call, now: NOW })).toMatchObject({ warmed: true });
    expect(calls).toHaveLength(1);
  });

  it("гонка: два крона одновременно — вызов один", async () => {
    const { ctx, calls, call } = setup({ runs: [minAgo(70)] });
    const [a, b] = await Promise.all([
      warmPricelistCache(ctx, { call, now: NOW }),
      warmPricelistCache(ctx, { call, now: NOW }),
    ]);
    expect([a, b].filter((r) => "warmed" in r)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    // И списание одно.
    const [row] = await aiJournal(ctx);
    expect(row).toMatchObject({ use: "cache_warm", calls: 1 });
  });

  it("гонка при уже записанной отметке прогрева — вызов тоже один", async () => {
    const { ctx, calls, call } = setup({
      runs: [minAgo(300)],
      extra: { [CACHE_WARM_KEY]: JSON.stringify({ at: minAgo(56) }) },
    });
    const both = await Promise.all([
      warmPricelistCache(ctx, { call, now: NOW }),
      warmPricelistCache(ctx, { call, now: NOW }),
    ]);
    expect(both.filter((r) => "warmed" in r)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("по умолчанию выключено: без галочки оператора не греет", async () => {
    const { ctx, calls, call } = setup({
      runs: [minAgo(70)],
      settings: { consultant_cache_warm: undefined },
    });
    expect(await warmPricelistCache(ctx, { call, now: NOW })).toEqual({ skipped: "off" });
    expect(calls).toHaveLength(0);
  });

  it("клиент не на v2, не консультант по прайсу или пустой ИИ-баланс — не греет", async () => {
    for (const s of [
      { settings: { served_by: "v1" } },
      { settings: { consultant_pricelist: { enabled: false } } },
      { extra: { ai_balance: JSON.stringify({ usd: 0, low: true, empty: true }) } },
    ]) {
      const { ctx, calls, call } = setup({ runs: [minAgo(70)], ...s });
      expect(await warmPricelistCache(ctx, { call, now: NOW })).toHaveProperty("skipped");
      expect(calls).toHaveLength(0);
    }
  });

  it("ответ консультанта не прочитался — ошибка, а не «можно греть»", async () => {
    const { ctx, db, calls, call } = setup({ runs: [minAgo(70)] });
    // Чтение ответов консультанта падает (тайм-аут базы): любой запрос к таблице — ошибка.
    const failing: unknown = new Proxy(
      {},
      {
        get: (_, k) =>
          k === "then"
            ? (ok: (r: unknown) => unknown) => ok({ data: null, error: { message: "timeout" } })
            : () => failing,
      },
    );
    const from = db.from.bind(db);
    (ctx as { db: unknown }).db = {
      ...db,
      from: (table: string) => (table === "consultant_message_runs" ? failing : from(table)),
    };
    await expect(warmPricelistCache(ctx, { call, now: NOW })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
