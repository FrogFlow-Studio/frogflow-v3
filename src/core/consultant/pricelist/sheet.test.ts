import { describe, expect, it, vi } from "vitest";

// Сообщение продавцу о неудачах таблицы: кому и что ушло в очередь.
const queued = vi.hoisted(() => [] as Array<{ text: string; chatId: string }>);
vi.mock("@/core/notify/recipients", () => ({ adminRecipients: async () => ["900"] }));
vi.mock("@/core/outbox/outbox", () => ({
  enqueueOutbox: async (_ctx: unknown, m: { text: string; target: { chatId: string } }) => {
    queued.push({ text: m.text, chatId: m.target.chatId });
  },
}));
vi.mock("@/core/ai/seller-text", async (orig) => ({
  ...(await orig<typeof import("@/core/ai/seller-text")>()),
  sellerLocaleSafe: async () => "ru",
}));
import { fakeDb } from "../../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sheetCsvUrl } from "@/core/catalog/sheet";
import type { FetchLike } from "@/core/catalog/sheet.server";
import type { ConsultantProduct } from "./catalog";
import { CATALOG_KEY, CATALOG_META_KEY } from "./catalog.server";
import {
  diffPricelists,
  nextSheetStatus,
  pricelistFingerprint,
  pricesJumped,
  shrunkTooMuch,
  SHEETS_STATUS_KEY,
  SHEETS_URL_KEY,
} from "./sheet";
import {
  importPricelistSheet,
  previewPricelistSheet,
  refreshPricelistSheet,
  SHEET_SOURCE,
} from "./sheet.server";

/**
 * Прайс консультанта из Google Таблицы (перенос importCatalogFromSheetsUrl и
 * крона refreshCatalogFromSavedSheet v1): предпросмотр с разницей, загрузка,
 * автообновление. Неудача никогда не стирает прайс.
 */
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=7`;
const now = new Date("2026-10-07T10:00:00Z");

const p = (name: string, price: number, size = ""): ConsultantProduct => ({
  id: name,
  name,
  category: "Полотенца",
  size,
  colors: [],
  price_kzt: price,
  stock: true,
});

const csv = (rows: Array<[string, number]>) =>
  ["Название;Раздел;Цена", ...rows.map(([n, c]) => `${n};Полотенца;${c}`)].join("\n");

function fetchOf(...bodies: Array<string | Response>): FetchLike & { calls: number } {
  const f = vi.fn(async () => {
    const b = bodies.shift();
    if (b === undefined) throw new Error("сеть");
    return typeof b === "string"
      ? new Response(b, { status: 200, headers: { "content-type": "text/csv" } })
      : b;
  });
  return Object.assign(f as unknown as FetchLike, {
    get calls() {
      return f.mock.calls.length;
    },
  });
}

let n = 0;
function ctxOf(settings: Record<string, string> = {}): TenantContext {
  const id = `20000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: id,
    key,
    value,
    updated_at: "2026-10-01T00:00:00.000Z",
  }));
  return {
    tenant: { id, name: "BOVI", settings: {}, modules: {}, vertical: "consultant" },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}
const setting = (ctx: TenantContext, key: string) =>
  (
    ctx.db as unknown as { tables: { app_settings: Array<{ key: string; value: string }> } }
  ).tables.app_settings.find((r) => r.key === key)?.value;
const catalogOf = (ctx: TenantContext) =>
  JSON.parse(setting(ctx, CATALOG_KEY) ?? "[]") as ConsultantProduct[];

describe("ссылка и разница", () => {
  it("строит export URL для Google Sheet", () => {
    expect(sheetCsvUrl(LINK)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=7`,
    );
    expect(sheetCsvUrl("https://example.com/file.csv")).toBeNull();
  });

  it("считает добавленные, пропавшие и со сменой цены — по названию и размеру", () => {
    const before = [
      p("Uchino Zero Twist", 21000, "70x140"),
      p("Feiler", 30000),
      p("Aquanova", 47000),
    ];
    // id из 1С — номер строки, он меняется; сравнение по названию его не замечает.
    const after = [
      { ...p("Uchino Zero Twist", 23000, "70x140"), id: "другой-id" },
      p("Aquanova", 47000),
      p("Dorelan", 500000),
    ];
    const d = diffPricelists(before, after);
    expect(d).toMatchObject({ added: 1, removed: 1, priceChanged: 1, unchanged: 1 });
    expect(d.samples).toEqual({
      added: ["Dorelan"],
      removed: ["Feiler"],
      priceChanged: [{ name: "Uchino Zero Twist", from: 21000, to: 23000 }],
    });
  });

  it("одинаковые строки считаются по отдельности", () => {
    expect(diffPricelists([p("A", 1)], [p("A", 1), p("A", 1)])).toMatchObject({
      added: 1,
      unchanged: 1,
    });
  });

  it("вдвое короче большого прайса — подозрительно, маленький прайс не охраняется", () => {
    expect(shrunkTooMuch(100, 49)).toBe(true);
    expect(shrunkTooMuch(100, 50)).toBe(false);
    expect(shrunkTooMuch(10, 1)).toBe(false);
  });

  it("неудача сохраняет время последнего удачного обновления", () => {
    const ok = nextSheetStatus(null, { ok: true, count: 5 }, now);
    expect(ok).toEqual({ at: now.toISOString(), ok: true, lastOkAt: now.toISOString(), count: 5 });
    const later = new Date(now.getTime() + 900_000);
    expect(nextSheetStatus(ok, { ok: false, reason: "closed" }, later)).toEqual({
      at: later.toISOString(),
      ok: false,
      reason: "closed",
      lastOkAt: now.toISOString(),
      count: 5,
      fails: 1,
    });
    const second = nextSheetStatus(
      nextSheetStatus(ok, { ok: false, reason: "closed" }, later),
      { ok: false, reason: "download" },
      later,
    );
    expect(second.fails).toBe(2);
  });
});

describe("предпросмотр и загрузка", () => {
  const OLD = JSON.stringify([p("Uchino", 21000), p("Feiler", 30000)]);

  it("предпросмотр показывает разницу и ничего не пишет", async () => {
    const ctx = ctxOf({ [CATALOG_KEY]: OLD });
    const r = await previewPricelistSheet(
      ctx,
      LINK,
      fetchOf(
        csv([
          ["Uchino", 22000],
          ["Dorelan", 9],
        ]),
      ),
    );
    expect(r).toMatchObject({
      ok: true,
      count: 2,
      current: 2,
      diff: { added: 1, removed: 1, priceChanged: 1, unchanged: 0 },
    });
    expect(setting(ctx, CATALOG_KEY)).toBe(OLD);
    expect(setting(ctx, SHEETS_URL_KEY)).toBeUndefined();
  });

  it("загрузка после предпросмотра заменяет прайс и подключает автообновление", async () => {
    const ctx = ctxOf({ [CATALOG_KEY]: OLD });
    const body = csv([
      ["Uchino", 22000],
      ["Dorelan", 9],
    ]);
    const pre = await previewPricelistSheet(ctx, LINK, fetchOf(body));
    if (!pre.ok) throw new Error("предпросмотр");
    const r = await importPricelistSheet(ctx, LINK, pre.fingerprint, fetchOf(body), now);
    expect(r).toMatchObject({ ok: true, meta: { count: 2, source: SHEET_SOURCE } });
    expect(catalogOf(ctx).map((x) => [x.name, x.price_kzt])).toEqual([
      ["Uchino", 22000],
      ["Dorelan", 9],
    ]);
    expect(setting(ctx, SHEETS_URL_KEY)).toBe(LINK);
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!)).toMatchObject({
      ok: true,
      lastOkAt: now.toISOString(),
      count: 2,
    });
  });

  it("таблица изменилась после предпросмотра — прайс не трогаем", async () => {
    const ctx = ctxOf({ [CATALOG_KEY]: OLD });
    const pre = await previewPricelistSheet(ctx, LINK, fetchOf(csv([["Uchino", 22000]])));
    if (!pre.ok) throw new Error("предпросмотр");
    const r = await importPricelistSheet(ctx, LINK, pre.fingerprint, fetchOf(csv([["Uchino", 1]])));
    expect(r).toEqual({ ok: false, reason: "changed" });
    expect(setting(ctx, CATALOG_KEY)).toBe(OLD);
    expect(setting(ctx, SHEETS_URL_KEY)).toBeUndefined();
  });

  it("закрытая таблица и таблица без цен — причина, прайс прежний", async () => {
    const ctx = ctxOf({ [CATALOG_KEY]: OLD });
    const login = new Response(null, {
      status: 302,
      headers: { location: "https://accounts.google.com/ServiceLogin" },
    });
    expect(await previewPricelistSheet(ctx, LINK, fetchOf(login))).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(await importPricelistSheet(ctx, LINK, "x", fetchOf("Название;Цена\nUchino;\n"))).toEqual(
      { ok: false, reason: "noRows" },
    );
    expect(setting(ctx, CATALOG_KEY)).toBe(OLD);
  });
});

describe("автообновление", () => {
  const OLD = [p("Uchino", 21000), p("Feiler", 30000)];
  const connected = (extra: Record<string, string> = {}) =>
    ctxOf({
      [CATALOG_KEY]: JSON.stringify(OLD),
      [CATALOG_META_KEY]: JSON.stringify({
        count: 2,
        importedAt: "2026-10-01T00:00:00.000Z",
        source: SHEET_SOURCE,
      }),
      [SHEETS_URL_KEY]: LINK,
      [SHEETS_STATUS_KEY]: JSON.stringify({
        at: "2026-10-07T09:45:00.000Z",
        ok: true,
        lastOkAt: "2026-10-07T09:45:00.000Z",
        count: 2,
      }),
      ...extra,
    });

  it("без подключённой таблицы ничего не скачивает", async () => {
    const f = fetchOf();
    expect(await refreshPricelistSheet(ctxOf(), now, f)).toEqual({ skipped: "none" });
    expect(f.calls).toBe(0);
  });

  it("сеть упала — прайс прежний, продавец видит время удачного обновления и причину", async () => {
    const ctx = connected();
    expect(await refreshPricelistSheet(ctx, now, fetchOf())).toEqual({
      ok: false,
      reason: "download",
    });
    expect(catalogOf(ctx)).toEqual(OLD);
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!)).toEqual({
      at: now.toISOString(),
      ok: false,
      reason: "download",
      lastOkAt: "2026-10-07T09:45:00.000Z",
      count: 2,
      fails: 1,
    });
  });

  it("пустая таблица или ошибка Google — прайс не стирается", async () => {
    for (const body of ["", "Название;Цена\n", new Response("oops", { status: 500 })]) {
      const ctx = connected();
      const r = await refreshPricelistSheet(ctx, now, fetchOf(body));
      expect(r).toMatchObject({ ok: false });
      expect(catalogOf(ctx)).toEqual(OLD);
    }
  });

  it("цены изменились — прайс заменён, время удачного обновления сдвинулось", async () => {
    const ctx = connected();
    expect(
      await refreshPricelistSheet(
        ctx,
        now,
        fetchOf(
          csv([
            ["Uchino", 25000],
            ["Feiler", 30000],
          ]),
        ),
      ),
    ).toEqual({ ok: true, count: 2, changed: true });
    expect(catalogOf(ctx).map((x) => x.price_kzt)).toEqual([25000, 30000]);
    expect(JSON.parse(setting(ctx, CATALOG_META_KEY)!)).toMatchObject({
      importedAt: now.toISOString(),
      source: SHEET_SOURCE,
    });
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!)).toMatchObject({
      ok: true,
      lastOkAt: now.toISOString(),
    });
  });

  it("таблица та же — прайс не переписывается, отмечается только проверка", async () => {
    const body = csv([
      ["Uchino", 21000],
      ["Feiler", 30000],
    ]);
    const ctx = connected();
    // Прайс в базе — ровно то, что даёт эта таблица.
    await refreshPricelistSheet(ctx, now, fetchOf(body));
    const meta = setting(ctx, CATALOG_META_KEY);
    const later = new Date(now.getTime() + 900_000);
    expect(await refreshPricelistSheet(ctx, later, fetchOf(body))).toEqual({
      ok: true,
      count: 2,
      changed: false,
    });
    expect(setting(ctx, CATALOG_META_KEY)).toBe(meta);
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!).lastOkAt).toBe(later.toISOString());
  });

  it("таблица вдвое короче большого прайса — не применяется", async () => {
    const big = Array.from({ length: 30 }, (_, i) => p(`Товар ${i}`, 1000 + i));
    const ctx = connected({ [CATALOG_KEY]: JSON.stringify(big) });
    expect(await refreshPricelistSheet(ctx, now, fetchOf(csv([["Товар 1", 1001]])))).toEqual({
      ok: false,
      reason: "shrunk",
    });
    expect(catalogOf(ctx)).toHaveLength(30);
  });

  it("цены прыгнули (сдвиг столбца) — автообновление не применяет, причина продавцу", async () => {
    const big = Array.from({ length: 30 }, (_, i) => p(`Товар ${i}`, 1000 + i));
    const ctx = connected({ [CATALOG_KEY]: JSON.stringify(big) });
    // Вместо цены — остаток: у всех позиций «цена» 1–30.
    const shifted = csv(big.map((x, i): [string, number] => [x.name, i + 1]));
    expect(await refreshPricelistSheet(ctx, now, fetchOf(shifted))).toEqual({
      ok: false,
      reason: "pricesJumped",
    });
    expect(catalogOf(ctx).map((x) => x.price_kzt)).toEqual(big.map((x) => x.price_kzt));
  });

  it("три неудачи подряд — одно сообщение продавцу на серию, два крона сразу — тоже одно", async () => {
    queued.length = 0;
    const ctx = connected();
    await refreshPricelistSheet(ctx, now, fetchOf());
    await refreshPricelistSheet(ctx, now, fetchOf());
    expect(queued).toHaveLength(0);
    await Promise.all([
      refreshPricelistSheet(ctx, now, fetchOf()),
      refreshPricelistSheet(ctx, now, fetchOf()),
    ]);
    await refreshPricelistSheet(ctx, now, fetchOf());
    expect(queued).toHaveLength(1);
    expect(queued[0]!.text).toContain("не обновляется");
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!).fails).toBe(5);
    // Удача обрывает серию; новая серия — новое сообщение.
    await refreshPricelistSheet(
      ctx,
      now,
      fetchOf(
        csv([
          ["Uchino", 21000],
          ["Feiler", 30000],
        ]),
      ),
    );
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!).fails).toBeUndefined();
    const later = new Date(now.getTime() + 60_000);
    for (let i = 0; i < 3; i++) await refreshPricelistSheet(ctx, later, fetchOf());
    expect(queued).toHaveLength(2);
  });

  it("два крона одновременно: прайс один, статус не теряет удачу", async () => {
    const body = csv([
      ["Uchino", 25000],
      ["Feiler", 30000],
    ]);
    const ctx = connected();
    const [a, b] = await Promise.all([
      refreshPricelistSheet(ctx, now, fetchOf(body)),
      refreshPricelistSheet(ctx, now, fetchOf(body)),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(catalogOf(ctx).map((x) => x.price_kzt)).toEqual([25000, 30000]);
    expect(JSON.parse(setting(ctx, SHEETS_STATUS_KEY)!)).toMatchObject({
      ok: true,
      lastOkAt: now.toISOString(),
    });
  });

  it("скачок цен: больше половины цен или многие в разы; мелкий прайс не охраняется", () => {
    const base = Array.from({ length: 40 }, (_, i) => p(`Т${i}`, 10_000 + i));
    const bump = (k: number, f: (x: number) => number) =>
      base.map((x, i) => (i < k ? { ...x, price_kzt: f(x.price_kzt) } : x));
    // Обычная переоценка: четверть позиций +10% — не подозрительно.
    expect(
      pricesJumped(
        base,
        bump(10, (x) => Math.round(x * 1.1)),
      ),
    ).toBe(false);
    // Больше половины цен изменилось.
    expect(
      pricesJumped(
        base,
        bump(21, (x) => x + 100),
      ),
    ).toBe(true);
    // Четыре позиции подешевели в 10 раз (10% от 40).
    expect(
      pricesJumped(
        base,
        bump(4, (x) => Math.round(x / 10)),
      ),
    ).toBe(true);
    expect(
      pricesJumped(
        base,
        bump(3, (x) => Math.round(x / 10)),
      ),
    ).toBe(false);
    // Маленький прайс — без охраны.
    expect(pricesJumped(base.slice(0, 10), bump(10, (x) => x * 10).slice(0, 10))).toBe(false);
  });

  it("отпечаток зависит от содержимого прайса", () => {
    expect(pricelistFingerprint(OLD)).toBe(pricelistFingerprint(JSON.parse(JSON.stringify(OLD))));
    expect(pricelistFingerprint(OLD)).not.toBe(pricelistFingerprint([OLD[0]!]));
  });
});
