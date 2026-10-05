import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { POPULAR_KEY, POPULAR_RUN_KEY, POPULAR_RUN_MIN_GAP_MS, parsePopular } from "./popular";
import { refreshPopularOnce } from "./popular.server";

/** Проход крона по автору (Л5): один за окно, считает победитель условной записи метки. */
const BOT = "b1";
const NOW = new Date("2026-10-05T12:00:00Z");
const P1 = "00000000-0000-4000-8000-000000000001";
let db: FakeDb;
const ctxFor = (d: FakeDb) =>
  ({
    tenant: { id: BOT, name: "Лавка", vertical: "shop", modules: {}, settings: {} },
    db: d,
  }) as unknown as TenantContext;
const setting = (key: string) =>
  (db.tables.app_settings ?? []).find((r) => r.bot_id === BOT && r.key === key)?.value as
    string | undefined;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.orders = [1, 2].map((id) => ({
    id,
    bot_id: BOT,
    telegram_id: 100 + id,
    status: "delivered",
    created_at: "2026-09-20T10:00:00.000Z",
  }));
  db.tables.order_items = [1, 2].map((id) => ({ id, order_id: id, product_id: P1 }));
});

describe("«Часто покупают»: один проход на автора за окно", () => {
  it("два запуска разом: считает один, второй пропускает; запись одна", async () => {
    const r = await Promise.all([
      refreshPopularOnce(ctxFor(db), NOW),
      refreshPopularOnce(ctxFor(db), NOW),
    ]);
    expect([...r].sort()).toEqual(["skipped", "updated"]);
    expect(parsePopular(setting(POPULAR_KEY))?.items).toEqual([{ id: P1, n: 2 }]);
    expect((db.tables.app_settings ?? []).filter((x) => x.key === POPULAR_KEY)).toHaveLength(1);
  });

  it("повторный запуск внутри окна пропускается, после окна считает снова", async () => {
    expect(await refreshPopularOnce(ctxFor(db), NOW)).toBe("updated");
    const soon = new Date(NOW.getTime() + 60_000);
    expect(await refreshPopularOnce(ctxFor(db), soon)).toBe("skipped");
    const later = new Date(NOW.getTime() + POPULAR_RUN_MIN_GAP_MS + 1000);
    expect(await refreshPopularOnce(ctxFor(db), later)).toBe("updated");
    expect(parsePopular(setting(POPULAR_KEY))?.at).toBe(later.toISOString());
  });

  it("сбой чтения заказов: ошибка наружу, метка снята, прежняя запись цела, следующий запуск считает", async () => {
    expect(await refreshPopularOnce(ctxFor(db), NOW)).toBe("updated");
    const before = setting(POPULAR_KEY);
    const later = new Date(NOW.getTime() + POPULAR_RUN_MIN_GAP_MS + 1000);
    await expect(
      refreshPopularOnce(ctxFor(withBrokenReads(db, ["orders"]) as unknown as FakeDb), later),
    ).rejects.toThrow();
    expect(setting(POPULAR_KEY)).toBe(before);
    expect(setting(POPULAR_RUN_KEY)).toBe("0");
    expect(await refreshPopularOnce(ctxFor(db), new Date(later.getTime() + 1000))).toBe("updated");
  });
});
