import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { room, ROOM_BOT, type Room } from "../dialogs/harness";
import {
  checkTurn,
  salesReport,
  salesSummary,
  scenarioResult,
  type SalesScenario,
  type TurnOutcome,
  type TurnResult,
} from "../sales-eval/checks";
import { SALES_SCENARIOS } from "../sales-eval/scenarios";

/**
 * Набор продаж консультанта в WhatsApp на живой модели. Покупатель — реплики
 * из настоящих диалогов (tests/sales-eval/scenarios.ts), бот — настоящий путь
 * канала (handleZernioMessage → консультант → кнопка «Купить» → заказ) на базе
 * в памяти со снимком каталога и анкеты магазина. В живую базу ничего не
 * пишется, ИИ-баланс магазина не тратится: платит ключ того, кто запускает.
 * Стоит денег (≈0,3 $ за прогон на Sonnet 5), поэтому запускается явно:
 *
 *   env -u ANTHROPIC_BASE_URL SALES_EVAL=1 SALES_EVAL_SNAPSHOT=<снимок.json> \
 *     ANTHROPIC_API_KEY=… npx vitest run tests/integration/sales-eval.test.ts
 *
 * SALES_EVAL_MODEL — модель консультанта (по умолчанию модель платформы),
 * SALES_EVAL_PLAYBOOK=v2 — «Сценарий продавца v2» (bots.settings.consultant_playbook),
 * SALES_EVAL_ONLY — id сценариев через запятую, SALES_EVAL_OUT — папка отчёта.
 *
 * Снимок — один select в SQL-редакторе Supabase (только чтение), результат
 * колонки snap сохранить в файл:
 *
 *   select jsonb_build_object('vertical', b.vertical, 'modules', b.modules,
 *     'app_settings', (select jsonb_object_agg(key, value) from app_settings a
 *       where a.bot_id = b.id and key in ('consultant_profile', 'consultant_knowledge',
 *       'consultant_enabled', 'shop_name')),
 *     'products', (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
 *       'description', p.description, 'price', p.price, 'country_prices', p.country_prices,
 *       'sort_order', p.sort_order, 'keywords', p.keywords,
 *       'variants', (select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name,
 *         'price', v.price, 'sort_order', v.sort_order) order by v.sort_order)
 *         from product_variants v where v.product_id = p.id)) order by p.sort_order)
 *       from products p where p.bot_id = b.id and p.is_active)) snap
 *   from bots b where b.id = '<id бота>';
 */
const on =
  process.env.SALES_EVAL === "1" &&
  Boolean(process.env.ANTHROPIC_API_KEY && process.env.SALES_EVAL_SNAPSHOT);

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }),
}));
vi.mock("@/channels/telegram/notify", async (orig) => ({
  ...(await orig<typeof import("@/channels/telegram/notify")>()),
  notifyAdminsHtml: async () => 1,
}));
vi.mock("@/core/notify/recipients", () => ({
  adminRecipients: async () => ["900"],
  shopAdminIds: async () => ["900"],
}));
vi.mock("@/core/catalog/low-stock", async (orig) => ({
  ...(await orig<typeof import("@/core/catalog/low-stock")>()),
  sellerLocale: async () => "ru",
}));

type Snapshot = {
  vertical?: string;
  modules?: Record<string, boolean>;
  app_settings?: Record<string, string>;
  products?: Array<{
    id: string;
    name: string;
    description?: string | null;
    price: number;
    country_prices?: Record<string, number> | null;
    sort_order?: number;
    keywords?: string | null;
    variants?: Array<{ id: string; name: string; price: number; sort_order: number }> | null;
  }>;
};

/** Комната WhatsApp со снимком магазина: каталог с вариантами, анкета, база знаний. */
function shopRoom(snap: Snapshot, locale: SalesScenario["locale"]): Room {
  const products = snap.products ?? [];
  const r = room({
    channel: "whatsapp",
    locale,
    full: true,
    vertical: snap.vertical ?? "digital",
    modules: { ...(snap.modules ?? {}), whatsapp: true, wa_shop: true },
    ...(process.env.SALES_EVAL_PLAYBOOK === "v2"
      ? { tenantSettings: { consultant_playbook: "v2" } }
      : {}),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      keywords: p.keywords ?? undefined,
      description: p.description ?? "",
    })),
  });
  const tables = r.db.tables as Record<string, Array<Record<string, unknown>>>;
  for (const row of tables.products ?? []) {
    const p = products.find((x) => x.id === row.id)!;
    const variants = (p.variants ?? []).map((v) => ({ ...v, product_id: p.id }));
    row.country_prices = p.country_prices ?? {};
    row.sort_order = p.sort_order ?? 0;
    row.product_variants = variants.map(({ product_id: _p, ...v }) => v);
    tables.product_variants!.push(...variants);
  }
  for (const [key, value] of Object.entries(snap.app_settings ?? {}))
    tables.app_settings!.push({ bot_id: ROOM_BOT, key, value });
  if (!snap.app_settings?.consultant_enabled)
    tables.app_settings!.push({ bot_id: ROOM_BOT, key: "consultant_enabled", value: "true" });
  return r;
}

/** Расход консультанта комнаты: счётчик consultant_usage (без разбора реплики triage). */
function spentUsd(r: Room): number {
  const row = (r.db.tables.app_settings ?? []).find((x) => x.key === "consultant_usage");
  try {
    return Number((JSON.parse(String(row?.value ?? "{}")) as { usd?: number }).usd) || 0;
  } catch {
    return 0;
  }
}

function pausedUntil(r: Room): string | null {
  const c = (r.state().consultant ?? {}) as { paused_until?: string | null };
  return c.paused_until ?? null;
}

type Played = TurnResult & {
  outcome: TurnOutcome;
  payloads: Array<{ title: string; payload: string }>;
};

async function runScenario(snap: Snapshot, s: SalesScenario) {
  const r = shopRoom(snap, s.locale);
  const turns: Played[] = [];
  for (const t of s.turns) {
    const ordersBefore = r.db.tables.orders?.length ?? 0;
    const pausedBefore = pausedUntil(r);
    let say: string;
    if ("click" in t) {
      // Нажимаем кнопку «Купить» из прошлого хода: нет её — нажимать нечего.
      const prev = turns.at(-1);
      const buy = prev?.payloads.find((b) => b.payload.startsWith("CBUY:"));
      if (!buy) {
        turns.push({
          say: "[нажатие «Купить»]",
          replies: [],
          buttons: [],
          flags: ["no_buy_button"],
          outcome: { replies: [], buttons: [], newOrders: 0, handedOff: false },
          payloads: [],
        });
        continue;
      }
      say = `[нажатие «${buy.title}»]`;
      await r.say({ button: buy.payload, title: buy.title });
    } else {
      say = t.text;
      await r.say({ text: t.text });
    }
    const outcome: TurnOutcome = {
      replies: r.replies(),
      buttons: r.buttons(),
      newOrders: (r.db.tables.orders?.length ?? 0) - ordersBefore,
      // Передача менеджеру ставит консультанта на паузу (state.consultant.paused_until).
      handedOff: pausedUntil(r) !== pausedBefore && Date.parse(pausedUntil(r) ?? "") > Date.now(),
    };
    turns.push({
      say,
      replies: outcome.replies,
      buttons: outcome.buttons,
      flags: checkTurn(outcome, t.expect),
      outcome,
      payloads: r.buttonPayloads?.() ?? [],
    });
  }
  return {
    result: scenarioResult(
      s,
      turns.map(({ payloads: _p, ...t }) => t),
    ),
    usd: spentUsd(r),
  };
}

describe.skipIf(!on)("набор продаж консультанта в WhatsApp (живая модель)", () => {
  it(
    "прогон и отчёт",
    async () => {
      const path = process.env.SALES_EVAL_SNAPSHOT!;
      const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
      expect(snap.products?.length, "в снимке нет товаров").toBeGreaterThan(0);
      setEnvForTests({
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        ...(process.env.SALES_EVAL_MODEL ? { CONSULTANT_MODEL: process.env.SALES_EVAL_MODEL } : {}),
      });
      const only = process.env.SALES_EVAL_ONLY?.split(",").map((x) => x.trim());
      const scenarios = only ? SALES_SCENARIOS.filter((s) => only.includes(s.id)) : SALES_SCENARIOS;
      const results = [];
      let usd = 0;
      for (const s of scenarios) {
        const out = await runScenario(snap, s);
        results.push(out.result);
        usd += out.usd;
        console.log(
          `[sales-eval] ${out.result.pass ? "ok " : "НЕТ"} ${s.id} ${out.result.flags.join(",")}`,
        );
      }
      const { DEFAULT_MODEL } = await import("@/core/consultant/engine.server");
      const model = process.env.SALES_EVAL_MODEL || DEFAULT_MODEL;
      const dir = process.env.SALES_EVAL_OUT || join(tmpdir(), "sales-eval");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(
        join(dir, `${stamp}.json`),
        JSON.stringify({ model, usd, summary: salesSummary(results), results }, null, 2),
      );
      writeFileSync(
        join(dir, `${stamp}.md`),
        salesReport(results, {
          model,
          usd,
          snapshot: `${path.split("/").at(-1) ?? path}${process.env.SALES_EVAL_PLAYBOOK === "v2" ? ", сценарий v2" : ""}`,
        }),
      );
      console.log(`[sales-eval] отчёт: ${join(dir, `${stamp}.md`)}`);
      setEnvForTests(undefined);
      // Это замер, а не ворота: прогон проходит, если дошёл до конца.
      expect(results.length).toBe(scenarios.length);
    },
    30 * 60_000,
  );
});
