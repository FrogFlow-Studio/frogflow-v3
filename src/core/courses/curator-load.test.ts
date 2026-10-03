import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { curatorKey } from "./curators.server";
import { curatorLoad } from "./curator-load.server";
import { hwKey } from "./homework";

/** Нагрузка кураторов: ждёт, проверено за 7 дней, самая давняя; без обрезки. */
const T = "11111111-2222-3333-4444-555555555555";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const L = "cccccccc-0000-4000-8000-000000000003";
const NOW = new Date("2026-10-20T10:00:00Z");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hw = (item: string, over: Record<string, unknown>) => ({
  rev: 1,
  orderItemId: item,
  lessonId: L,
  productId: "dddddddd-0000-4000-8000-000000000004",
  course: "Аквагрим",
  lessonNo: 2,
  lessonTitle: "Урок",
  student: `Ученик ${item}`,
  status: "submitted",
  attempts: [{ at: "2026-10-01T00:00:00Z", text: "работа", files: [] }],
  feedback: null,
  updatedAt: "2026-10-18T00:00:00Z",
  ...over,
});

function shop(items: Array<[string, string | null, Record<string, unknown>]>) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = items.flatMap(([id, cur, over]) => [
    { bot_id: T, key: hwKey(id, L), value: JSON.stringify(hw(id, over)) },
    ...(cur ? [{ bot_id: T, key: curatorKey(id), value: cur }] : []),
  ]);
  return {
    tenant: {
      id: T,
      modules: { courses: true },
      settings: {
        curators: {
          mode: "rotate",
          items: [
            { id: A, name: "Анна", telegram_id: 1 },
            { id: B, name: "Борис", telegram_id: 2 },
          ],
        },
      },
    },
    db,
    timezone: "UTC",
  } as unknown as TenantContext;
}
const fb = (at: string, status = "accepted") => ({
  status,
  feedback: { at, text: "ok", by: "x", status },
});

describe("нагрузка кураторов", () => {
  it("ждёт, проверено за 7 дней, самая давняя; работа без куратора — отдельной строкой", async () => {
    const ctx = shop([
      [id(1), A, { updatedAt: "2026-10-10T00:00:00Z" }],
      [id(2), A, { updatedAt: "2026-10-15T00:00:00Z" }],
      [id(3), A, fb("2026-10-18T00:00:00Z")],
      [id(4), A, fb("2026-10-01T00:00:00Z")], // давно — не считается
      [id(5), B, fb("2026-10-19T00:00:00Z", "revise")],
      [id(6), null, {}],
    ]);
    const r = await curatorLoad(ctx, NOW);
    expect(r.map((x) => [x.name, x.waiting, x.reviewed7d])).toEqual([
      ["Анна", 2, 1],
      ["Борис", 0, 1],
      ["", 1, 0],
    ]);
    expect(r[0]!.oldest).toMatchObject({ at: "2026-10-10T00:00:00Z", student: `Ученик ${id(1)}` });
    expect(r[1]!.oldest).toBeNull();
  });

  it("кураторов нет — пусто; больше тысячи работ — все посчитаны", async () => {
    const none = shop([]);
    (none.tenant.settings as { curators: unknown }).curators = { mode: "rotate", items: [] };
    expect(await curatorLoad(none, NOW)).toEqual([]);
    const many = shop(
      Array.from(
        { length: 1100 },
        (_, i) => [id(i + 100), A, {}] as [string, string, Record<string, unknown>],
      ),
    );
    expect((await curatorLoad(many, NOW))[0]!.waiting).toBe(1100);
  });
});
