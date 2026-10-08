import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  addTodo,
  loadTodos,
  parseTodos,
  removeTodo,
  setTodoDone,
  todoView,
  TODOS_KEY,
  TODOS_LIMIT,
  type SellerTodo,
} from "./seller-todos";

/**
 * Свои задачи продавца в «Что сделать сегодня» (А3 пожеланий Кристины):
 * строка app_settings, условные записи, перенос невыполненных на сегодня.
 */
const T = "10000000-0000-0000-0000-000000000001";
function ctxOf(broken: string[] = []) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: T, settings: { served_by: "v2" }, modules: {} },
    db: broken.length ? withBrokenReads(db, broken) : db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

const stored = (db: ReturnType<typeof fakeDb>) =>
  JSON.parse(
    String(db.tables.app_settings!.find((r) => r.key === TODOS_KEY)?.value ?? "[]"),
  ) as SellerTodo[];

const at = (iso: string) => new Date(iso);
const id = (n: number) => `todo${String(n).padStart(6, "0")}`;

describe("свои задачи продавца", () => {
  it("добавить, отметить, вернуть, удалить — всё видно в записи", async () => {
    const { ctx, db } = ctxOf();
    await addTodo(ctx, {
      id: id(1),
      text: "  выложить Reels  ",
      day: "2026-10-08",
      by: "kristina",
    });
    expect(stored(db)).toEqual([
      expect.objectContaining({
        id: id(1),
        text: "выложить Reels",
        day: "2026-10-08",
        by: "kristina",
        done: false,
      }),
    ]);
    expect(await setTodoDone(ctx, id(1), true, "helper", at("2026-10-08T12:00:00Z"))).toBe(true);
    expect(stored(db)[0]).toMatchObject({
      done: true,
      doneBy: "helper",
      doneAt: "2026-10-08T12:00:00.000Z",
    });
    expect(await setTodoDone(ctx, id(1), false, "helper")).toBe(true);
    expect(stored(db)[0]!.done).toBe(false);
    expect(stored(db)[0]!.doneAt).toBeUndefined();
    expect(await removeTodo(ctx, id(1))).toBe(true);
    expect(stored(db)).toEqual([]);
    expect(await removeTodo(ctx, id(1))).toBe(false);
    expect(await setTodoDone(ctx, id(1), true, null)).toBe(false);
  });

  it("пустой текст — понятный отказ, ничего не записано", async () => {
    const { ctx, db } = ctxOf();
    await expect(addTodo(ctx, { id: id(1), text: "   ", day: "2026-10-08" })).rejects.toMatchObject(
      {
        key: "err.todos.empty",
      },
    );
    expect(db.tables.app_settings).toEqual([]);
  });

  it("двойной Enter (тот же id одновременно и позже) — одна задача", async () => {
    const { ctx, db } = ctxOf();
    const input = { id: id(1), text: "позвонить в типографию", day: "2026-10-08" };
    await Promise.all([addTodo(ctx, input), addTodo(ctx, input)]);
    await addTodo(ctx, input);
    expect(stored(db)).toHaveLength(1);
  });

  it("гонка: два устройства добавляют и отмечают одновременно — ничего не затёрто", async () => {
    const { ctx, db } = ctxOf();
    await addTodo(ctx, { id: id(1), text: "а", day: "2026-10-08" });
    await Promise.all([
      setTodoDone(ctx, id(1), true, "owner"),
      addTodo(ctx, { id: id(2), text: "б", day: "2026-10-08" }),
      addTodo(ctx, { id: id(3), text: "в", day: "2026-10-09" }),
    ]);
    const list = stored(db);
    expect(list.map((t) => t.id).sort()).toEqual([id(1), id(2), id(3)]);
    expect(list.find((t) => t.id === id(1))!.done).toBe(true);
  });

  it("вчерашняя невыполненная — в сегодня с отметкой, будущая — в «Позже», сделанные отдельно", () => {
    const list: SellerTodo[] = [
      { id: id(1), text: "сегодня", day: "2026-10-08", at: "2026-10-08T05:00:00Z", done: false },
      { id: id(2), text: "вчера", day: "2026-10-07", at: "2026-10-07T05:00:00Z", done: false },
      { id: id(3), text: "завтра", day: "2026-10-09", at: "2026-10-08T06:00:00Z", done: false },
      {
        id: id(4),
        text: "сделано",
        day: "2026-10-07",
        at: "2026-10-07T06:00:00Z",
        done: true,
        doneAt: "2026-10-07T09:00:00Z",
      },
    ];
    const v = todoView(list, "2026-10-08");
    expect(v.due.map((t) => [t.text, t.carried])).toEqual([
      ["вчера", true],
      ["сегодня", false],
    ]);
    expect(v.later.map((t) => t.text)).toEqual(["завтра"]);
    expect(v.done.map((t) => t.text)).toEqual(["сделано"]);
  });

  it("сделанные старше 30 дней уходят при следующей записи, открытые остаются", async () => {
    const { ctx, db } = ctxOf();
    db.tables.app_settings!.push({
      bot_id: T,
      key: TODOS_KEY,
      updated_at: "2026-09-01T00:00:00Z",
      value: JSON.stringify([
        {
          id: id(1),
          text: "старая сделанная",
          day: "2026-08-01",
          at: "2026-08-01T00:00:00Z",
          done: true,
          doneAt: "2026-08-02T00:00:00Z",
        },
        {
          id: id(2),
          text: "старая открытая",
          day: "2026-08-01",
          at: "2026-08-01T00:00:00Z",
          done: false,
        },
      ]),
    });
    await addTodo(ctx, { id: id(3), text: "новая", day: "2026-10-08" }, at("2026-10-08T00:00:00Z"));
    expect(stored(db).map((t) => t.id)).toEqual([id(2), id(3)]);
  });

  it(`открытых ${TODOS_LIMIT} — новая не добавляется, старые не теряются`, async () => {
    const { ctx, db } = ctxOf();
    const full = Array.from({ length: TODOS_LIMIT }, (_, i) => ({
      id: id(i),
      text: `задача ${i}`,
      day: "2026-10-08",
      at: "2026-10-08T00:00:00Z",
      done: false,
    }));
    db.tables.app_settings!.push({
      bot_id: T,
      key: TODOS_KEY,
      updated_at: null,
      value: JSON.stringify(full),
    });
    await expect(
      addTodo(ctx, { id: id(9999), text: "лишняя", day: "2026-10-08" }),
    ).rejects.toMatchObject({ key: "err.todos.full" });
    expect(stored(db)).toHaveLength(TODOS_LIMIT);
  });

  it("сбой чтения — ошибка, а не «задач нет»; кривой JSON — пусто", async () => {
    await expect(loadTodos(ctxOf(["app_settings"]).ctx)).rejects.toThrow();
    expect(parseTodos("{не json")).toEqual([]);
    expect(parseTodos(JSON.stringify([{ id: "x", text: "коротк. id" }, null]))).toEqual([]);
  });
});
