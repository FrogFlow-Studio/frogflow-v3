import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { COPY } from "@/channels/telegram/copy";
import { commissionableAmount } from "@/core/commission/commission";
import type { Locale } from "@/core/i18n/locale";
import {
  mailbox,
  modelHold,
  modelSeen,
  notices,
  outbound,
  room,
  ROOM_BOT,
  type Channel,
  type Product,
} from "./harness";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { invalidatePricelist } from "@/core/consultant/pricelist/catalog.server";
import { SCENARIOS, type Says } from "./scenarios";
import { BURST } from "@/core/consultant/burst";
import { liveAutomationApi } from "@/channels/zernio/automations.server";

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
// Пределы вызовов модели в памяти процесса — на платформу (600 в минуту) и
// на клиента (60 в минуту, у всех комнат один id бота): сценарии идут в одном
// процессе подряд, и поздние упирались в чужой счёт. Счёт клиента в базе
// комнаты — настоящий (на нём сценарий «остался один вызов»).
vi.mock("@/core/consultant/rate.server", async (orig) => {
  const real = await orig<typeof import("@/core/consultant/rate.server")>();
  const { rateLimiter, takeShared } = await import("@/core/storefront/rate-limit");
  return {
    ...real,
    takeAiCall: (ctx: TenantContext) =>
      takeShared(ctx, "consultant_ai", "calls", real.CLIENT_CALLS, rateLimiter(4)),
  };
});
// Консультант по прайсу (`pricelist` в сценарии): настоящий runConsultant, подменён
// только ответ API модели — раунды по очереди из сценария.
const modelRounds: { list: Array<Array<Record<string, unknown>>> } = { list: [] };
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  const create = async (req: { messages?: Array<{ role: string; content: unknown }> }) => {
    const last = req.messages?.filter((m) => m.role === "user").at(-1);
    const blocks = Array.isArray(last?.content)
      ? (last.content as Array<{ type: string; text?: string; content?: unknown }>)
      : [{ type: "text", text: String(last?.content ?? "") }];
    modelSeen.calls.push({
      images: blocks.filter((b) => b.type === "image").length,
      // Пометки — в тексте, выдача инструментов — в tool_result.
      text: blocks
        .map((b) =>
          b.type === "tool_result"
            ? typeof b.content === "string"
              ? b.content
              : JSON.stringify(b.content ?? "")
            : (b.text ?? ""),
        )
        .join("\n"),
    });
    // Модель думает (в жизни — секунды): соседние вебхуки успевают встать в очередь
    // диалога. В пачке — ровно до того, как встали все (harness.modelHold).
    await (modelHold.wait ?? new Promise((r) => setTimeout(r, 15)));
    return {
      stop_reason: "end_turn",
      content: modelRounds.list.shift() ?? [{ type: "text", text: "" }],
      usage: { input_tokens: 100, output_tokens: 20 },
    };
  };
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

// Сообщения подряд ждут соседний ход: в тестах перечитывают состояние каждые 5 мс.
BURST.pollMs = 5;
// Ход с фото ждёт тишины после фото пачки: в тестах — доли секунды.
BURST.settleMs = 100;
BURST.settleShortMs = 100;

beforeEach(() => {
  setEnvForTests({});
  notices.count = 0;
  mailbox.to = [];
  consultantStub.reply = undefined;
  modelRounds.list = [];
});
const realAutomationApi = { ...liveAutomationApi };
afterEach(() => {
  setEnvForTests(undefined);
  Object.assign(liveAutomationApi, realAutomationApi);
});

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
        // Прайс читается заново: сценарий со сбоем чтения не должен попасть в кэш соседа.
        invalidatePricelist({ tenant: { id: ROOM_BOT } } as TenantContext);
        modelRounds.list = s.pricelist.rounds.map((round) => [...round]);
      }
      if (s.postpay) {
        // ИИ после оплаты: настоящий вызов через SDK, ответ инструмента decide — из сценария.
        setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
        modelRounds.list = s.postpay.map((d) => [
          { type: "tool_use", id: "t1", name: "decide", input: { email: "", ...d } },
        ]);
      }
      if (s.triage) {
        // Разбор реплики перед обращением: настоящий вызов через SDK, ответ инструмента triage.
        setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
        modelRounds.list = s.triage.map((d) => [
          { type: "tool_use", id: "t1", name: "triage", input: { country: "", ...d } },
        ]);
      }
      if (s.countryAi) {
        // Страна из слов: настоящий вызов через SDK, ответ инструмента country — из сценария.
        setEnvForTests({ ANTHROPIC_API_KEY: "sk-test" });
        modelRounds.list = s.countryAi.map((d) => [
          { type: "tool_use", id: "t1", name: "country", input: d },
        ]);
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
      if (s.automations) {
        // Правила Zernio из сценария; сообщение правила «уходит» без сети.
        const rules = s.automations;
        liveAutomationApi.list = async () => rules as never;
        liveAutomationApi.inbox = (async () => ({ ok: true })) as never;
        liveAutomationApi.tail = async () => [];
      }
      s.arrange?.(r);
      const c = COPY[s.locale];
      const has = (all: string, x: Says) =>
        x instanceof RegExp ? x.test(all) : all.includes(typeof x === "function" ? x(c) : x);
      let step = 0;
      for (const { say, expect: e } of s.steps) {
        step++;
        const before = notices.count;
        const mailsBefore = mailbox.to.length;
        const queuedBefore = r.sellerQueued();
        const ruleSent = () =>
          (r.db.tables.zernio_logs ?? []).filter((l) => l.event_type === "two_step_dm_sent").length;
        const ruleBefore = ruleSent();
        modelSeen.calls = [];
        await r.say(say);
        const where = `шаг ${step} ${JSON.stringify(say)}`;
        const all = r.replies().join("\n");
        if (e.silent) expect(r.replies(), where).toEqual([]);
        if (e.count !== undefined) expect(r.replies(), where).toHaveLength(e.count);
        for (const x of e.says ?? [])
          expect(has(all, x), `${where}: нет «${String(x)}» в «${all}»`).toBe(true);
        for (const x of e.notSays ?? [])
          expect(has(all, x), `${where}: лишнее «${String(x)}» в «${all}»`).toBe(false);
        for (const b of e.buttons ?? []) expect(r.buttons(), where).toContain(b);
        for (const b of e.noButtons ?? [])
          expect(has(r.buttons().join("\n"), b), `${where}: лишняя кнопка «${String(b)}»`).toBe(
            false,
          );
        if (e.mails) expect(mailbox.to.slice(mailsBefore), `${where}: письма`).toEqual(e.mails);
        if (e.cart !== undefined) expect(r.cart().length, `${where}: корзина`).toBe(e.cart);
        if (e.state) expect(r.state(), `${where}: состояние`).toMatchObject(e.state);
        for (const [id, fields] of Object.entries(e.orders ?? {}))
          expect(
            r.db.tables.orders?.find((o) => o.id === Number(id)),
            `${where}: заказ #${id}`,
          ).toMatchObject(fields);
        const seen = r.sellerReplies().join("\n");
        for (const x of e.sellerSees ?? [])
          expect(has(seen, x), `${where}: продавцу нет «${String(x)}» в «${seen}»`).toBe(true);
        if (e.reasons !== undefined)
          expect(r.reasons().length, `${where}: причины ответов`).toBeGreaterThanOrEqual(e.reasons);
        if (e.sellerNotices !== undefined)
          expect(notices.count - before, where).toBe(e.sellerNotices);
        if (e.ruleMessages !== undefined)
          expect(ruleSent() - ruleBefore, `${where}: сообщений правил Zernio`).toBe(e.ruleMessages);
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
        if (e.modelImages !== undefined)
          expect(
            modelSeen.calls.map((c) => c.images),
            `${where}: картинок модели по вызовам`,
          ).toEqual(e.modelImages);
        for (const x of e.modelSees ?? []) {
          const seen = modelSeen.calls.map((c) => c.text).join("\n");
          expect(has(seen, x), `${where}: модель не видела «${String(x)}»`).toBe(true);
        }
        if (e.history) {
          const recent =
            (r.state().consultant as { recent?: Array<{ role: string; text: string }> } | undefined)
              ?.recent ?? [];
          const asked = recent.filter((t) => t.role === "customer").map((t) => t.text);
          for (const h of e.history)
            expect(
              asked.flatMap((t) => t.split("\n\n")).filter((t) => t === h),
              `${where}: «${h}» в истории ровно один раз (${JSON.stringify(asked)})`,
            ).toHaveLength(1);
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
