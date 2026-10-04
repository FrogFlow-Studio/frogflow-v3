import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";

const db = fakeDb({ unique: { market_events: [["kind", "key", "bucket", "dedupe"]] } });
let tenants: Array<Record<string, unknown>> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({ tenantDirectory: async () => tenants }));

const srv = await import("./analytics.server");

const NOW = Date.UTC(2026, 9, 4, 10, 30);
const SHOP_A = "11111111-1111-1111-1111-111111111111";
const SHOP_B = "22222222-2222-2222-2222-222222222222";
const dev = (n: number) => ({ ip: `10.0.0.${n}`, ua: "UA", secret: "secret" });
const shop = (id: string, name: string, listed = true) => ({
  id,
  name,
  settings: { served_by: "v2", marketplace: { listed, approved: true } },
});
const rows = () => db.tables.market_events!;

beforeEach(() => {
  db.tables.market_events = [];
  tenants = [shop(SHOP_A, "Аня"), shop(SHOP_B, "Боря")];
});

describe("аналитика площадки: запись", () => {
  it("одно устройство за час считается один раз, другое устройство и другой час — отдельно", async () => {
    expect((await srv.recordMarketEvent({ kind: "visit", ...dev(1), now: NOW })).counted).toBe(
      true,
    );
    expect(
      (await srv.recordMarketEvent({ kind: "visit", ...dev(1), now: NOW + 600_000 })).counted,
    ).toBe(false);
    expect((await srv.recordMarketEvent({ kind: "visit", ...dev(2), now: NOW })).counted).toBe(
      true,
    );
    expect(
      (await srv.recordMarketEvent({ kind: "visit", ...dev(1), now: NOW + 3_600_000 })).counted,
    ).toBe(true);
    expect(rows()).toHaveLength(3);
  });

  it("два одинаковых посещения одновременно — одна строка", async () => {
    const res = await Promise.all([
      srv.recordMarketEvent({ kind: "visit", ...dev(1), now: NOW }),
      srv.recordMarketEvent({ kind: "visit", ...dev(1), now: NOW }),
    ]);
    expect(res.filter((r) => r.counted)).toHaveLength(1);
    expect(rows()).toHaveLength(1);
  });

  it("без личных данных: в строках нет ни адреса, ни браузера, ни секрета", async () => {
    await srv.recordMarketEvent({ kind: "search", key: "Торты", ...dev(7), now: NOW });
    const dump = JSON.stringify(rows());
    expect(dump).not.toContain("10.0.0.7");
    expect(dump).not.toContain("UA");
    expect(dump).not.toContain("secret");
    expect(rows()[0]).toMatchObject({ kind: "search", key: "торты" });
  });

  it("пустой поиск, чужой вид и кривой id магазина не пишутся", async () => {
    expect(
      (await srv.recordMarketEvent({ kind: "search", key: "  ", ...dev(1), now: NOW })).counted,
    ).toBe(false);
    expect(
      (await srv.recordMarketEvent({ kind: "click", key: "не-id", ...dev(1), now: NOW })).counted,
    ).toBe(false);
    expect(
      (await srv.recordMarketEvent({ kind: "hack" as never, ...dev(1), now: NOW })).counted,
    ).toBe(false);
    expect(rows()).toHaveLength(0);
  });

  it("одно устройство за час не забьёт счётчик случайными фразами", async () => {
    for (let i = 0; i < 40; i++)
      await srv.recordMarketEvent({ kind: "search", key: `фраза ${i}`, ...dev(1), now: NOW });
    expect(rows()).toHaveLength(30);
  });

  it("таблицы нет: молчит, а не падает", async () => {
    delete (db.tables as Record<string, unknown>).market_events;
    // Любой вызов цепочки возвращает ту же цепочку; в конце — ответ PostgREST «таблицы нет».
    const err = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
    const chain: unknown = new Proxy(() => chain, {
      get: (_t, k) =>
        k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(err).then(ok) : chain,
      apply: () => chain,
    });
    const spy = vi.spyOn(db, "from").mockImplementation((() => chain) as never);
    try {
      expect((await srv.recordMarketEvent({ kind: "visit", ...dev(1), now: NOW })).counted).toBe(
        false,
      );
      expect(await srv.marketOverview(NOW)).toBeNull();
      expect(await srv.shopMarketClicks(SHOP_A, NOW)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("аналитика площадки: чтение", () => {
  async function fill() {
    // Больше страницы (1000), чтобы постраничное чтение не теряло строки.
    for (let i = 0; i < 1100; i++)
      rows().push({
        id: `e${String(i).padStart(5, "0")}`,
        kind: "visit",
        key: "",
        bucket: "b",
        dedupe: `d${i}`,
        created_at: new Date(NOW - 86_400_000).toISOString(),
      });
    await srv.recordMarketEvent({ kind: "search", key: "торт", ...dev(1), now: NOW - 1000 });
    await srv.recordMarketEvent({ kind: "empty", key: "курсы", ...dev(1), now: NOW - 1000 });
    await srv.recordMarketEvent({ kind: "click", key: SHOP_A, ...dev(1), now: NOW - 1000 });
    await srv.recordMarketEvent({ kind: "click", key: SHOP_A, ...dev(2), now: NOW - 1000 });
  }

  it("сводка оператора: все посещения учтены без обрезки, поиски, пустые поиски, магазины без трафика", async () => {
    await fill();
    const s = (await srv.marketOverview(NOW))!;
    expect(s.visits).toBe(1100);
    expect(s.topSearches).toEqual([{ query: "торт", count: 1 }]);
    expect(s.emptySearches).toEqual([{ query: "курсы", count: 1 }]);
    expect(s.clicks).toBe(2);
    expect(s.shops).toEqual([
      { id: SHOP_B, name: "Боря", clicks: 0 },
      { id: SHOP_A, name: "Аня", clicks: 2 },
    ]);
  });

  it("чтение событий упало (не «таблицы нет») — сбой, а не пустая сводка", async () => {
    const real = db.from.bind(db);
    const spy = vi
      .spyOn(db, "from")
      .mockImplementation(((t: string) =>
        t === "market_events" ? withBrokenReads(db, ["market_events"]).from(t) : real(t)) as never);
    try {
      await expect(srv.marketOverview(NOW)).rejects.toThrow();
      await expect(srv.shopMarketClicks(SHOP_A, NOW)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("переходы в магазин, которого нет на площадке, не теряются и не приписываются другим", async () => {
    await fill();
    tenants = [shop(SHOP_B, "Боря"), shop(SHOP_A, "Аня", false)];
    const s = (await srv.marketOverview(NOW))!;
    expect(s.shops.map((x) => x.id)).toEqual([SHOP_B]);
    expect(s.otherClicks).toBe(2);
  });

  it("события старше 30 дней в сводку не попадают; магазин видит только свои переходы", async () => {
    await fill();
    await srv.recordMarketEvent({ kind: "click", key: SHOP_B, ...dev(3), now: NOW - 1000 });
    await srv.recordMarketEvent({
      kind: "click",
      key: SHOP_A,
      ...dev(4),
      now: NOW - 40 * 86_400_000,
    });
    expect(await srv.shopMarketClicks(SHOP_A, NOW)).toEqual({ days: 30, clicks: 2 });
    expect(await srv.shopMarketClicks(SHOP_B, NOW)).toEqual({ days: 30, clicks: 1 });
  });
});
