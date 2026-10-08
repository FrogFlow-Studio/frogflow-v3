import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { settingsFromJson } from "@/core/tenant/directory";
import {
  addTask,
  capTasks,
  clearTasks,
  loadTasks,
  parseTasks,
  closeTaskAfterReply,
  setTaskDone,
  taskFromHandoff,
  TASKS_KEY,
  telegramDialogLink,
  type ConsultantTask,
} from "./tasks";

/**
 * Задачи консультанта (перенос v1 consultant/tasks.ts): передача менеджеру —
 * строка в списке продавца; общий с v1 ключ app_settings, условные записи.
 */
function ctxOf(pricelist = true) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const ctx = {
    tenant: {
      id: "10000000-0000-0000-0000-000000000001",
      name: "BOVI",
      settings: settingsFromJson(pricelist ? { consultant_pricelist: { enabled: true } } : {}),
      modules: {},
      vertical: "consultant",
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

const stored = (db: ReturnType<typeof fakeDb>) =>
  JSON.parse(
    String(db.tables.app_settings!.find((r) => r.key === TASKS_KEY)?.value ?? "[]"),
  ) as ConsultantTask[];

const customer = {
  userKey: "ig:42",
  platform: "instagram",
  telegramId: -42,
  username: "aigul.k",
  firstName: "Айгуль",
  lastName: null,
  contactPhone: null,
  state: {},
} as unknown as Customer;

const at = (iso: string) => new Date(iso);

describe("задачи консультанта", () => {
  it("читает формат v1: задачи BOVI до переезда видны", () => {
    const v1 = JSON.stringify([
      {
        id: "tsk_abc",
        at: "2026-10-01T10:00:00.000Z",
        userKey: "ig:1",
        reason: "question",
        text: "Есть ли наматрасник 160х200?",
        contact: "+77001112233",
        done: false,
      },
      { id: "", at: "x", userKey: "" },
      "мусор",
    ]);
    expect(parseTasks(v1)).toEqual([
      {
        id: "tsk_abc",
        at: "2026-10-01T10:00:00.000Z",
        userKey: "ig:1",
        reason: "question",
        text: "Есть ли наматрасник 160х200?",
        contact: "+77001112233",
        done: false,
      },
    ]);
    expect(parseTasks("не json")).toEqual([]);
    expect(parseTasks(null)).toEqual([]);
  });

  it("передача — задача с покупателем, каналом, сутью, товарами и ссылкой на диалог", async () => {
    const { ctx, db } = ctxOf();
    const t = await taskFromHandoff(
      ctx,
      customer,
      {
        reason: "purchase",
        summary: "Берёт Uchino 50х100, самовывоз",
        customerContact: "+7 700 111 22 33",
      },
      {
        channel: "instagram",
        products: ["Uchino полотенце 50x100 (9 000 ₸)"],
        link: "https://ig.me/m/aigul.k",
        sourceId: "mid-1",
      },
      at("2026-10-07T09:00:00Z"),
    );
    expect(t).not.toBeNull();
    expect(stored(db)).toEqual([
      {
        id: t!.id,
        at: "2026-10-07T09:00:00.000Z",
        userKey: "ig:42",
        reason: "purchase",
        text: "Берёт Uchino 50х100, самовывоз",
        contact: "+7 700 111 22 33",
        done: false,
        channel: "instagram",
        name: "Айгуль",
        products: ["Uchino полотенце 50x100 (9 000 ₸)"],
        link: "https://ig.me/m/aigul.k",
      },
    ]);
  });

  it("не консультант по прайсу — задач не ведёт", async () => {
    const { ctx, db } = ctxOf(false);
    const t = await taskFromHandoff(
      ctx,
      customer,
      { reason: "human_requested", summary: "" },
      { channel: "instagram" },
    );
    expect(t).toBeNull();
    expect(db.tables.app_settings).toEqual([]);
  });

  it("ссылка не из https и чужой канал не записываются", async () => {
    const { ctx, db } = ctxOf();
    await addTask(ctx, {
      userKey: "ig:1",
      reason: "photo",
      text: "фото",
      link: "javascript:alert(1)",
      channel: "sms" as never,
    });
    const [t] = stored(db);
    expect(t!.link).toBeUndefined();
    expect(t!.channel).toBeUndefined();
  });

  it("гонка: две передачи одновременно — обе задачи в списке", async () => {
    const { ctx, db } = ctxOf();
    await Promise.all([
      addTask(ctx, { userKey: "ig:1", reason: "purchase", text: "а", sourceId: "m1" }),
      addTask(ctx, { userKey: "ig:2", reason: "complaint", text: "б", sourceId: "m2" }),
    ]);
    expect(
      stored(db)
        .map((t) => t.userKey)
        .sort(),
    ).toEqual(["ig:1", "ig:2"]);
  });

  it("повтор того же события (одновременно и позже) — одна задача", async () => {
    const { ctx, db } = ctxOf();
    const input = { userKey: "ig:1", reason: "purchase", text: "а", sourceId: "m1" };
    await Promise.all([addTask(ctx, input), addTask(ctx, input)]);
    await addTask(ctx, input);
    expect(stored(db)).toHaveLength(1);
  });

  it("отметка «сделано» и обратно; чужой id — false", async () => {
    const { ctx, db } = ctxOf();
    const t = await addTask(ctx, { userKey: "ig:1", reason: "human_requested", text: "" });
    expect(await setTaskDone(ctx, t!.id, true, at("2026-10-07T10:00:00Z"))).toBe(true);
    expect(stored(db)[0]).toMatchObject({ done: true, doneAt: "2026-10-07T10:00:00.000Z" });
    expect(await setTaskDone(ctx, t!.id, false)).toBe(true);
    expect(stored(db)[0]!.done).toBe(false);
    expect(stored(db)[0]!.doneAt).toBeUndefined();
    expect(await setTaskDone(ctx, "tsk_нет", true)).toBe(false);
  });

  it("гонка: отметка и новая передача одновременно — не затирают друг друга", async () => {
    const { ctx, db } = ctxOf();
    const t = await addTask(ctx, { userKey: "ig:1", reason: "purchase", text: "а" });
    await Promise.all([
      setTaskDone(ctx, t!.id, true),
      addTask(ctx, { userKey: "ig:2", reason: "complaint", text: "б" }),
    ]);
    const list = stored(db);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.id === t!.id)!.done).toBe(true);
  });

  it("убрать сделанные — открытые остаются; убрать всё — пусто", async () => {
    const { ctx, db } = ctxOf();
    const a = await addTask(ctx, { userKey: "ig:1", reason: "purchase", text: "а" });
    await addTask(ctx, { userKey: "ig:2", reason: "complaint", text: "б" });
    await setTaskDone(ctx, a!.id, true);
    expect(await clearTasks(ctx, "done")).toEqual({ removed: 1 });
    expect(stored(db).map((t) => t.userKey)).toEqual(["ig:2"]);
    expect(await clearTasks(ctx, "all")).toEqual({ removed: 1 });
    expect(stored(db)).toEqual([]);
  });

  it("предел списка: сначала уходят старые сделанные, открытые остаются", () => {
    const mk = (i: number, done: boolean): ConsultantTask => ({
      id: `t${i}`,
      at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      userKey: `ig:${i}`,
      reason: "purchase",
      text: "",
      done,
    });
    const list = [mk(1, false), mk(2, true), mk(3, true), mk(4, false), mk(5, false)];
    expect(capTasks(list, 3).map((t) => t.id)).toEqual(["t1", "t4", "t5"]);
    // Открытые не вытесняются, даже если их больше предела.
    expect(capTasks(list, 2).map((t) => t.id)).toEqual(["t1", "t4", "t5"]);
    // Только сверх жёсткого потолка открытых уходят самые старые из них.
    expect(capTasks(list, 2, 2).map((t) => t.id)).toEqual(["t4", "t5"]);
  });

  it("список свежими сверху; сбой чтения — ошибка, а не «задач нет»", async () => {
    const { ctx, db } = ctxOf();
    await addTask(ctx, { userKey: "ig:1", reason: "a", text: "" }, at("2026-10-01T00:00:00Z"));
    await addTask(ctx, { userKey: "ig:2", reason: "b", text: "" }, at("2026-10-02T00:00:00Z"));
    expect((await loadTasks(ctx)).map((t) => t.userKey)).toEqual(["ig:2", "ig:1"]);
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      q.maybeSingle = (async () => ({ data: null, error: { message: "обрыв" } })) as never;
      return q;
    };
    await expect(loadTasks(ctx)).rejects.toThrow();
  });

  it("менеджер ответил — все задачи покупателя до ответа закрыты, с каналом ответа", async () => {
    const { ctx, db } = ctxOf();
    const old = await addTask(
      ctx,
      { userKey: "ig:1", reason: "purchase", text: "а" },
      at("2026-10-01T00:00:00Z"),
    );
    const fresh = await addTask(
      ctx,
      { userKey: "ig:1", reason: "complaint", text: "б" },
      at("2026-10-02T00:00:00Z"),
    );
    // Передача после ответа менеджера — новая просьба: остаётся открытой.
    const later = await addTask(
      ctx,
      { userKey: "ig:1", reason: "photo", text: "в" },
      at("2026-10-04T00:00:00Z"),
    );
    await addTask(ctx, { userKey: "ig:2", reason: "purchase", text: "г" });
    expect(
      await closeTaskAfterReply(ctx, "ig:1", at("2026-10-05T00:00:00Z"), {
        via: "instagram",
        repliedAt: at("2026-10-03T00:00:00Z"),
      }),
    ).toBe(true);
    const byId = (id: string) => stored(db).find((t) => t.id === id)!;
    for (const t of [old!, fresh!]) {
      expect(byId(t.id)).toMatchObject({ done: true, doneVia: "instagram" });
      expect(byId(t.id).doneAt).toBe("2026-10-05T00:00:00.000Z");
    }
    expect(byId(later!.id).done).toBe(false);
    expect(stored(db).find((t) => t.userKey === "ig:2")!.done).toBe(false);
    expect(await closeTaskAfterReply(ctx, "ig:3")).toBe(false);
  });

  it("гонка: два ответа менеджера и новая передача одновременно — закрывает один, новая цела", async () => {
    const { ctx, db } = ctxOf();
    const open = await addTask(
      ctx,
      { userKey: "ig:1", reason: "purchase", text: "а" },
      at("2026-10-01T00:00:00Z"),
    );
    const results = await Promise.all([
      closeTaskAfterReply(ctx, "ig:1", at("2026-10-02T00:00:00Z"), { via: "panel" }),
      closeTaskAfterReply(ctx, "ig:1", at("2026-10-02T00:00:00Z"), { via: "instagram" }),
      addTask(ctx, { userKey: "ig:2", reason: "wholesale", text: "б" }, at("2026-10-02T00:00:00Z")),
    ]);
    // Закрыл ровно один ответ: второй перечитал список и закрывать было нечего.
    expect(results.slice(0, 2).filter(Boolean)).toHaveLength(1);
    const list = stored(db);
    expect(list).toHaveLength(2);
    expect(list.find((t) => t.id === open!.id)).toMatchObject({ done: true });
    expect(list.find((t) => t.userKey === "ig:2")).toMatchObject({ done: false });
  });

  it("«Сделано» руками — отметка manual; вернуть в работу — отметка снята", async () => {
    const { ctx, db } = ctxOf();
    const t = await addTask(ctx, { userKey: "ig:1", reason: "purchase", text: "а" });
    await setTaskDone(ctx, t!.id, true);
    expect(stored(db)[0]).toMatchObject({ done: true, doneVia: "manual" });
    await setTaskDone(ctx, t!.id, false);
    expect(stored(db)[0]!.doneVia).toBeUndefined();
    expect(stored(db)[0]!.doneAt).toBeUndefined();
  });

  it("не консультант по прайсу — ответ менеджера задачи не трогает", async () => {
    const { ctx } = ctxOf(false);
    expect(await closeTaskAfterReply(ctx, "ig:1")).toBe(false);
  });

  it("ссылка на диалог в Telegram — только по нику", () => {
    expect(telegramDialogLink("@bovi_client")).toBe("https://t.me/bovi_client");
    expect(telegramDialogLink(null)).toBeNull();
    expect(telegramDialogLink("a b")).toBeNull();
  });
});
