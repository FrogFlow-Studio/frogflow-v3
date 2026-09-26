import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { isStampedCopyKey, STAMP_KEEP_DAYS, staleStampedCopies } from "./watermark";
import { CHECK_CHUNK, pruneStampedCopies, stampedKey } from "./watermark.server";

const V2 = "11111111-2222-3333-4444-555555555555";
const V1 = "99999999-8888-7777-6666-555555555555";
const NOW = Date.parse("2026-09-26T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

/** Хранилище в памяти: ключ → дата записи. list отдаёт содержимое папки, как Supabase. */
function fakeStorage(files: Record<string, string>) {
  const removed: string[] = [];
  const listed: string[] = [];
  const storage = {
    from: () => ({
      list: async (prefix: string) => {
        listed.push(prefix);
        const data = Object.entries(files)
          .filter(([k]) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes("/"))
          .map(([k, at]) => ({ name: k.slice(prefix.length + 1), updated_at: at, created_at: at }));
        return { data, error: null };
      },
      remove: async (keys: string[]) => {
        removed.push(...keys);
        for (const k of keys) delete files[k];
        return { data: [], error: null };
      },
    }),
  };
  return { storage: storage as never, removed, listed, files };
}

const copy = (tenant: string, order: number, src = `${tenant}/orig-${order}.pdf`) =>
  stampedKey(tenant, order, src);

describe("чистка копий PDF со знаком", () => {
  it("формат ключа: только копии v2 этого клиента", () => {
    expect(isStampedCopyKey(V2, copy(V2, 7))).toBe(true);
    expect(isStampedCopyKey(V1, copy(V2, 7))).toBe(false);
    expect(isStampedCopyKey(V2, `${V2}/propisi.pdf`)).toBe(false);
    expect(isStampedCopyKey(V2, `${V2}/wm/Прописи.pdf`)).toBe(false);
    expect(isStampedCopyKey(V2, `${V2}/wm/7-abc.pdf`)).toBe(false);
    expect(isStampedCopyKey(V2, `${V2}/wm/sub/7-0123456789abcdef.pdf`)).toBe(false);
    expect(isStampedCopyKey(V2, `${V2}/wm/../orig.pdf`)).toBe(false);
  });

  it("удаляет только копии старше срока, свежие и без даты оставляет", () => {
    const old = copy(V2, 1);
    const fresh = copy(V2, 2);
    const stale = staleStampedCopies(
      V2,
      [
        { name: old.split("/wm/")[1]!, updated_at: daysAgo(STAMP_KEEP_DAYS + 1) },
        { name: fresh.split("/wm/")[1]!, updated_at: daysAgo(STAMP_KEEP_DAYS - 1) },
        { name: "3-0123456789abcdef.pdf", updated_at: null, created_at: null },
      ],
      NOW,
    );
    expect(stale).toEqual([old]);
  });

  it("никогда не трогает оригиналы товаров и файлы клиентов прежней платформы", async () => {
    const oldCopy = copy(V2, 1);
    const fs = fakeStorage({
      // копия v2 — к удалению
      [oldCopy]: daysAgo(40),
      // оригиналы товаров v2, в т. ч. очень старые
      [`${V2}/propisi.pdf`]: daysAgo(400),
      [`${V2}/a1b2c3.pdf`]: daysAgo(400),
      // файл не нашего формата в wm/ (например, загруженный вручную)
      [`${V2}/wm/Урок.pdf`]: daysAgo(400),
      // клиент v1: его хранилище общее, но чистка v2 его не видит
      [`${V1}/material.pdf`]: daysAgo(400),
      [copy(V1, 5)]: daysAgo(400),
    });
    const r = await pruneStampedCopies([V2], NOW, { storage: fs.storage, db: fakeDb() as never });
    expect(fs.removed).toEqual([oldCopy]);
    expect(r).toEqual({ deleted: 1, done: true });
    expect(fs.listed).toEqual([`${V2}/wm`]);
    expect(Object.keys(fs.files).sort()).toEqual(
      [
        `${V2}/propisi.pdf`,
        `${V2}/a1b2c3.pdf`,
        `${V2}/wm/Урок.pdf`,
        `${V1}/material.pdf`,
        copy(V1, 5),
      ].sort(),
    );
  });

  it("ключ, на который ссылается товар или заказ как на оригинал, не удаляется", async () => {
    const k1 = copy(V2, 1);
    const k2 = copy(V2, 2);
    const k3 = copy(V2, 3);
    const fs = fakeStorage({ [k1]: daysAgo(40), [k2]: daysAgo(40), [k3]: daysAgo(40) });
    const db = fakeDb();
    db.tables.product_material_files = [{ file_path: k1 }];
    db.tables.order_items = [{ file_path_snapshot: k2, file_path_kz_snapshot: null }];
    db.tables.products = [];
    await pruneStampedCopies([V2], NOW, { storage: fs.storage, db: db as never });
    expect(fs.removed).toEqual([k3]);
  });

  it("проверка «не оригинал» идёт пачками, чтобы адрес запроса не вырос", async () => {
    const keys = Array.from({ length: 250 }, (_, i) => copy(V2, i + 1));
    const fs = fakeStorage(Object.fromEntries(keys.map((k) => [k, daysAgo(40)])));
    const db = fakeDb();
    // Оригинал в третьей пачке: пачки не теряют найденное друг у друга.
    db.tables.product_material_files = [{ file_path: keys[230] }];
    db.tables.products = [];
    db.tables.order_items = [];
    const sizes: number[] = [];
    const spy = {
      from: (t: string) => {
        const q = db.from(t);
        return {
          select: (cols: string) => {
            const s = q.select(cols) as unknown as {
              in: (c: string, v: string[]) => unknown;
            };
            const orig = s.in.bind(s);
            s.in = (c, v) => {
              sizes.push(v.length);
              return orig(c, v);
            };
            return s;
          },
        };
      },
    };
    const r = await pruneStampedCopies([V2], NOW, { storage: fs.storage, db: spy as never });
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHECK_CHUNK);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(250 * 5);
    expect(r.deleted).toBe(249);
    expect(fs.removed).not.toContain(keys[230]);
  });

  it("без клиентов в границах — ничего не читает и не удаляет", async () => {
    const fs = fakeStorage({ [copy(V1, 1)]: daysAgo(400) });
    expect(
      await pruneStampedCopies([], NOW, { storage: fs.storage, db: fakeDb() as never }),
    ).toEqual({ deleted: 0, done: true });
    expect(fs.listed).toEqual([]);
    expect(fs.removed).toEqual([]);
  });
});
