import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { COPY } from "@/channels/telegram/copy";
import { commissionableAmount } from "@/core/commission/commission";
import type { Locale } from "@/core/i18n/locale";
import { notices, outbound, room, type Channel, type Product } from "./harness";
import { SCENARIOS, type Says } from "./scenarios";

/** Золотые диалоги (Б14): прогон сценариев из scenarios.ts на настоящем коде каналов. */

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
// Поиск по коду в базе в памяти не работает (нет .or): ни один код не найден.
vi.mock("@/core/catalog/catalog", async (orig) => ({
  ...(await orig<typeof import("@/core/catalog/catalog")>()),
  searchProducts: async () => [],
}));
vi.mock("@/channels/telegram/notify", async (orig) => ({
  ...(await orig<typeof import("@/channels/telegram/notify")>()),
  notifyAdminsHtml: async () => {
    notices.count++;
    return 1;
  },
}));
// Сообщение покупателю не из его реплики (трек от продавца) уходит в «комнату».
vi.mock("@/channels/zernio/outbound.server", async (orig) => ({
  ...(await orig<typeof import("@/channels/zernio/outbound.server")>()),
  sendToZernioTargetResult: async (_t: unknown, html: string) => {
    outbound.sink?.(html);
    return { ok: true };
  },
}));
// Продавец — один, Telegram-id 900 (см. SELLER_ID в harness).
vi.mock("@/core/notify/recipients", () => ({
  adminRecipients: async () => ["900"],
  shopAdminIds: async () => ["900"],
}));
// Консультант по прайсу (`pricelist` в сценарии): настоящий runConsultant, подменён
// только ответ API модели — раунды по очереди из сценария.
const modelRounds: { list: Array<Array<Record<string, unknown>>> } = { list: [] };
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  const create = async () => ({
    stop_reason: "end_turn",
    content: modelRounds.list.shift() ?? [{ type: "text", text: "" }],
    usage: { input_tokens: 100, output_tokens: 20 },
  });
  return {
    default: Object.assign(
      class {
        messages = { create };
      },
      { APIError },
    ),
  };
});
// Модель консультанта подменена ответом сценария (`consultant`); маршрут до неё — настоящий.
const consultantStub: { reply: string | null | undefined } = { reply: undefined };
vi.mock("@/core/consultant/engine.server", async (orig) => {
  const real = await orig<typeof import("@/core/consultant/engine.server")>();
  return {
    ...real,
    runConsultant: async (...args: Parameters<typeof real.runConsultant>) => {
      if (consultantStub.reply === undefined) return real.runConsultant(...args);
      if (consultantStub.reply === null) return null;
      return { reply: consultantStub.reply, usage: { inputTokens: 0, outputTokens: 0, usd: 0 } };
    },
  };
});
vi.mock("@/core/catalog/low-stock", async (orig) => ({
  ...(await orig<typeof import("@/core/catalog/low-stock")>()),
  sellerLocale: async () => "ru",
}));

beforeEach(() => {
  setEnvForTests({});
  notices.count = 0;
  consultantStub.reply = undefined;
  modelRounds.list = [];
});
afterEach(() => setEnvForTests(undefined));

describe("набор золотых диалогов", () => {
  it("не меньше 25 сценариев; все три канала и языки ru, kk, uz; id не повторяются", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(new Set(SCENARIOS.map((s) => s.channel))).toEqual(
      new Set(["telegram", "instagram", "whatsapp"]),
    );
    expect(new Set(SCENARIOS.map((s) => s.locale))).toEqual(new Set(["ru", "kk", "uz"]));
  });
});

describe("золотые диалоги", () => {
  for (const s of SCENARIOS)
    it(`${s.id}: ${s.title} (${s.origin})`, async () => {
      if (s.consultant !== undefined) {
        // Консультант включён: ключ ИИ есть, ответ модели — из сценария.
        setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
        consultantStub.reply = s.consultant;
      }
      if (s.pricelist) {
        setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
        modelRounds.list = s.pricelist.rounds.map((round) => [...round]);
      }
      const r = room(
        s.pricelist
          ? {
              ...s,
              tenantSettings: { ...s.tenantSettings, consultant_pricelist: { enabled: true } },
            }
          : s,
      );
      if (s.pricelist)
        r.db.tables.app_settings!.push(
          { key: "consultant_enabled", value: "true" },
          { key: "consultant_catalog_json", value: JSON.stringify(s.pricelist.catalog) },
        );
      s.arrange?.(r);
      const c = COPY[s.locale];
      const has = (all: string, x: Says) =>
        x instanceof RegExp ? x.test(all) : all.includes(typeof x === "function" ? x(c) : x);
      let step = 0;
      for (const { say, expect: e } of s.steps) {
        step++;
        const before = notices.count;
        const queuedBefore = r.sellerQueued();
        await r.say(say);
        const where = `шаг ${step} ${JSON.stringify(say)}`;
        const all = r.replies().join("\n");
        if (e.silent) expect(r.replies(), where).toEqual([]);
        if (e.count !== undefined) expect(r.replies().length, where).toBe(e.count);
        for (const x of e.says ?? [])
          expect(has(all, x), `${where}: нет «${String(x)}» в «${all}»`).toBe(true);
        for (const x of e.notSays ?? [])
          expect(has(all, x), `${where}: лишнее «${String(x)}» в «${all}»`).toBe(false);
        for (const b of e.buttons ?? []) expect(r.buttons(), where).toContain(b);
        for (const b of e.noButtons ?? [])
          expect(has(r.buttons().join("\n"), b), `${where}: лишняя кнопка «${String(b)}»`).toBe(
            false,
          );
        if (e.cart !== undefined) expect(r.cart().length, `${where}: корзина`).toBe(e.cart);
        if (e.state) expect(r.state(), `${where}: состояние`).toMatchObject(e.state);
        const seen = r.sellerReplies().join("\n");
        for (const x of e.sellerSees ?? [])
          expect(has(seen, x), `${where}: продавцу нет «${String(x)}» в «${seen}»`).toBe(true);
        if (e.reasons !== undefined)
          expect(r.reasons().length, `${where}: причины ответов`).toBeGreaterThanOrEqual(e.reasons);
        if (e.sellerNotices !== undefined)
          expect(notices.count - before, where).toBe(e.sellerNotices);
        if (e.sellerQueued !== undefined)
          expect(r.sellerQueued() - queuedBefore, `${where}: в очереди продавцу`).toBe(
            e.sellerQueued,
          );
        if (e.paused !== undefined) {
          const until = (r.state().consultant as { paused_until?: string } | undefined)
            ?.paused_until;
          const paused = Boolean(until) && Date.parse(until!) > Date.now();
          expect(paused, `${where}: консультант на паузе`).toBe(e.paused);
        }
        if (e.tasks) {
          const raw = r.db.tables.app_settings!.find((x) => x.key === "consultant_tasks_json")
            ?.value as string | undefined;
          const tasks = raw ? (JSON.parse(raw) as unknown[]) : [];
          expect(tasks, `${where}: задачи консультанта`).toHaveLength(e.tasks.length);
          e.tasks.forEach((t, i) => expect(tasks[i], `${where}: задача ${i + 1}`).toMatchObject(t));
        }
      }
    });
});

/** Д5: одна и та же корзина в трёх каналах — один и тот же заказ и сумма; комиссия за ботовые заказы нулевая. */
describe("Д5: заказ из одной корзины в трёх каналах", () => {
  const PARITY: Product[] = [
    { id: "a0000000-0000-4000-8000-000000000001", name: "018. Прописи", price: 1000 },
    { id: "a0000000-0000-4000-8000-000000000002", name: "019. Пазлы", price: 1500 },
  ];
  const CHANNELS: Channel[] = ["telegram", "instagram", "whatsapp"];

  /** Корзина из двух товаров → оформление; возвращает то, что записано в базу. */
  async function checkout(channel: Channel, locale: Locale) {
    const r = room({ channel, locale, products: PARITY });
    await r.say({ text: "каталог" });
    if (channel === "telegram") {
      for (const p of PARITY) await r.say({ button: `add:${p.id}::u` });
      await r.say({ button: "checkout" });
      await r.say({ text: "+77770637152" });
    } else {
      await r.say({ text: "1, 2" });
      await r.say({ button: "CHECKOUT" });
    }
    const order = r.db.tables.orders![0]!;
    const items = (r.db.tables.order_items ?? [])
      .map((i) => ({
        product_id: i.product_id,
        name: i.name_snapshot,
        quantity: i.quantity,
        price: i.price_snapshot,
      }))
      .sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));
    return { r, order, items, text: r.replies().join("\n") };
  }
  const shape = (o: Record<string, unknown>) => ({
    total: o.total,
    currency: o.currency,
    status: o.status,
    fulfillment_kind: o.fulfillment_kind,
    discount_amount: o.discount_amount,
    points_used: o.points_used,
    delivery_fee: o.delivery_fee,
    country_code: o.country_code,
  });

  for (const locale of ["ru", "kk", "uz"] as const)
    it(`${locale}: Telegram, Instagram и WhatsApp дают один заказ: состав, сумма, статус`, async () => {
      const got = await Promise.all(CHANNELS.map((c) => checkout(c, locale)));
      for (const g of got) {
        expect(g.r.db.tables.orders, "заказ один").toHaveLength(1);
        expect(g.order.total).toBe(2500);
        expect(g.order.status).toBe("awaiting_payment");
        expect(g.text, "покупателю назван заказ и сумма").toContain("2500");
      }
      expect(got[0]!.items).toEqual([
        { product_id: PARITY[0]!.id, name: "018. Прописи", quantity: 1, price: 1000 },
        { product_id: PARITY[1]!.id, name: "019. Пазлы", quantity: 1, price: 1500 },
      ]);
      for (const g of got.slice(1)) {
        expect(shape(g.order)).toEqual(shape(got[0]!.order));
        expect(g.items).toEqual(got[0]!.items);
      }
      expect(got.map((g) => g.order.platform)).toEqual(["telegram", "instagram", "whatsapp"]);
    });

  it("комиссия платформы с оплаченного заказа бота — 0; тот же заказ с витрины сайта — считается", async () => {
    for (const channel of CHANNELS) {
      const { order } = await checkout(channel, "ru");
      const paid = {
        platform: String(order.platform),
        status: "delivered",
        total: order.total as number,
        currency: String(order.currency),
        day: "2026-10-04",
      };
      expect(commissionableAmount(paid), `${channel}: заказ бота`).toBe(0);
      expect(
        commissionableAmount({ ...paid, platform: "web" }),
        `${channel}: тот же с витрины`,
      ).toBe(2500);
    }
  });
});
