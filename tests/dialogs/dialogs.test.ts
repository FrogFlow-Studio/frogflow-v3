import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { COPY } from "@/channels/telegram/copy";
import { notices, outbound, room } from "./harness";
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
vi.mock("@/core/catalog/low-stock", async (orig) => ({
  ...(await orig<typeof import("@/core/catalog/low-stock")>()),
  sellerLocale: async () => "ru",
}));

beforeEach(() => {
  setEnvForTests({});
  notices.count = 0;
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
      const r = room(s);
      s.arrange?.(r);
      const c = COPY[s.locale];
      const has = (all: string, x: Says) =>
        x instanceof RegExp ? x.test(all) : all.includes(typeof x === "function" ? x(c) : x);
      let step = 0;
      for (const { say, expect: e } of s.steps) {
        step++;
        const before = notices.count;
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
        if (e.cart !== undefined) expect(r.cart().length, `${where}: корзина`).toBe(e.cart);
        if (e.state) expect(r.state(), `${where}: состояние`).toMatchObject(e.state);
        const seen = r.sellerReplies().join("\n");
        for (const x of e.sellerSees ?? [])
          expect(has(seen, x), `${where}: продавцу нет «${String(x)}» в «${seen}»`).toBe(true);
        if (e.reasons !== undefined)
          expect(r.reasons().length, `${where}: причины ответов`).toBeGreaterThanOrEqual(e.reasons);
        if (e.sellerNotices !== undefined)
          expect(notices.count - before, where).toBe(e.sellerNotices);
      }
    });
});
