import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isUserError } from "@/core/i18n/user-error";

const reported: Array<{ message: string; where: string; key: unknown }> = [];
vi.mock("@/lib/errors", () => ({
  reportError: vi.fn(async (e: Error, c: { where: string; extra?: Record<string, unknown> }) => {
    reported.push({ message: e.message, where: c.where, key: c.extra?.key });
  }),
}));

const { setSetting, trySetSetting, getSetting, updateSettingAtomic, updateSettingStamped } =
  await import("./settings");

const BOT = "11111111-1111-1111-1111-111111111111";
type Op = "select" | "insert" | "update";

/**
 * fakeDb, у которого запрос нужного вида к app_settings отвечает ошибкой
 * или (update) не находит строк — как база с отказом прав или обрывом.
 */
function flaky(db: FakeDb, fail: Partial<Record<Op, "error" | "no-rows">>) {
  return {
    from(table: string) {
      const q = db.from(table);
      if (table !== "app_settings") return q;
      const wrap = (op: Op) => {
        const mode = fail[op]!;
        const res =
          mode === "no-rows"
            ? { data: [], error: null }
            : { data: null, error: { code: "42501", message: "permission denied" } };
        const chain: Record<string, unknown> = {
          then: (ok: (r: unknown) => unknown) => Promise.resolve(res).then(ok),
        };
        for (const m of ["eq", "select", "maybeSingle", "limit"]) chain[m] = () => chain;
        return chain;
      };
      return new Proxy(q, {
        get(target, prop, recv) {
          if (prop === "insert" || prop === "update")
            return (arg: unknown) => {
              const next = (target[prop] as (a: unknown) => unknown).call(target, arg);
              return fail[prop] ? wrap(prop) : next;
            };
          if (prop === "select" && fail.select) return () => wrap("select");
          return Reflect.get(target, prop, recv);
        },
      });
    },
  } as unknown as TenantContext["db"];
}

function ctxWith(db: unknown) {
  return { tenant: { id: BOT }, db } as unknown as TenantContext;
}

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("ожидали отказ");
}

beforeEach(() => {
  reported.length = 0;
});

describe("setSetting", () => {
  it("новый ключ вставляется, существующий обновляется", async () => {
    const db = fakeDb();
    const ctx = ctxWith(db);
    await setSetting(ctx, "shop_currency", "KZT");
    await setSetting(ctx, "shop_currency", "RUB");
    expect(db.tables.app_settings).toEqual([
      expect.objectContaining({ bot_id: BOT, key: "shop_currency", value: "RUB" }),
    ]);
    expect(await getSetting(ctx, "shop_currency")).toBe("RUB");
    expect(reported).toEqual([]);
  });

  it("база отказала во вставке — честная ошибка продавцу и отчёт в Sentry", async () => {
    const ctx = ctxWith(flaky(fakeDb(), { insert: "error" }));
    const e = await rejection(setSetting(ctx, "consultant_knowledge", "текст"));
    expect(isUserError(e)).toBe(true);
    expect((e as { key: string }).key).toBe("err.settings.saveFailed");
    expect(reported).toEqual([
      expect.objectContaining({ where: "settings.save", key: "consultant_knowledge" }),
    ]);
    expect(reported[0]!.message).toContain("permission denied");
  });

  it("база отказала в обновлении — не «сохранено»", async () => {
    const db = fakeDb();
    db.tables.app_settings = [{ bot_id: BOT, key: "k", value: "old" }];
    const e = await rejection(setSetting(ctxWith(flaky(db, { update: "error" })), "k", "new"));
    expect(isUserError(e)).toBe(true);
    expect(db.tables.app_settings[0]!.value).toBe("old");
  });

  it("обновление не задело ни одной строки (права, чужой клиент) — тоже ошибка", async () => {
    const db = fakeDb();
    db.tables.app_settings = [{ bot_id: BOT, key: "k", value: "old" }];
    const e = await rejection(setSetting(ctxWith(flaky(db, { update: "no-rows" })), "k", "new"));
    expect(isUserError(e)).toBe(true);
    expect(reported[0]!.message).toContain("не обновилась");
  });

  it("не смогли прочитать, есть ли ключ, — ошибка, а не слепая вставка", async () => {
    const db = fakeDb();
    const e = await rejection(setSetting(ctxWith(flaky(db, { select: "error" })), "k", "v"));
    expect(isUserError(e)).toBe(true);
    expect(db.tables.app_settings ?? []).toEqual([]);
  });

  it("ключ вставили параллельно между чтением и вставкой — дописываем обновлением", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    const ctx = ctxWith(db);
    await Promise.all([setSetting(ctx, "k", "a"), setSetting(ctx, "k", "b")]);
    expect(db.tables.app_settings).toHaveLength(1);
    expect(["a", "b"]).toContain(db.tables.app_settings![0]!.value);
    expect(reported).toEqual([]);
  });
});

describe("trySetSetting — служебные счётчики бота и кронов", () => {
  it("сбой не ломает обработку: false и отчёт в Sentry", async () => {
    const ctx = ctxWith(flaky(fakeDb(), { insert: "error" }));
    expect(await trySetSetting(ctx, "consultant_daily", "{}")).toBe(false);
    expect(reported).toEqual([
      expect.objectContaining({ where: "settings.write", key: "consultant_daily" }),
    ]);
  });

  it("успех — true, без отчёта", async () => {
    expect(await trySetSetting(ctxWith(fakeDb()), "k", "v")).toBe(true);
    expect(reported).toEqual([]);
  });
});

describe("updateSettingAtomic — параллельные изменения не теряются", () => {
  const db = () => fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });

  it("20 параллельных прибавок дают 20, включая гонку за первую вставку", async () => {
    const ctx = ctxWith(db());
    const inc = (raw: string | null) => String(Number(raw ?? 0) + 1);
    const res = await Promise.all(
      Array.from({ length: 20 }, () => updateSettingAtomic(ctx, "n", inc, 50)),
    );
    expect(res.every((r) => r === "written")).toBe(true);
    expect(await getSetting(ctx, "n")).toBe("20");
  });

  it("предел с проверкой в next: из 30 параллельных проходят ровно 5", async () => {
    const ctx = ctxWith(db());
    const capped = (raw: string | null) => {
      const n = Number(raw ?? 0);
      return n >= 5 ? null : String(n + 1);
    };
    const res = await Promise.all(
      Array.from({ length: 30 }, () => updateSettingAtomic(ctx, "n", capped, 50)),
    );
    expect(res.filter((r) => r === "written")).toHaveLength(5);
    expect(res.filter((r) => r === "failed")).toHaveLength(0);
    expect(await getSetting(ctx, "n")).toBe("5");
  });

  it("30 одновременных броней при свободном пределе записываются все, с попытками по умолчанию", async () => {
    reported.length = 0;
    const ctx = ctxWith(db());
    await trySetSetting(ctx, "n", "0");
    const inc = (raw: string | null) => String(Number(raw ?? 0) + 1);
    const res = await Promise.all(
      Array.from({ length: 30 }, () => updateSettingAtomic(ctx, "n", inc)),
    );
    expect(res.filter((r) => r !== "written")).toEqual([]);
    expect(await getSetting(ctx, "n")).toBe("30");
    expect(reported.filter((r) => r.where === "settings.atomic")).toEqual([]);
  });

  it("гонка не выиграна за отведённые попытки — failed, а не молчаливая запись", async () => {
    reported.length = 0;
    const ctx = ctxWith(db());
    const inc = (raw: string | null) => String(Number(raw ?? 0) + 1);
    const res = await Promise.all(
      Array.from({ length: 10 }, () => updateSettingAtomic(ctx, "n", inc, 1)),
    );
    const written = res.filter((r) => r === "written").length;
    expect(res).toContain("failed");
    expect(await getSetting(ctx, "n")).toBe(String(written));
    expect(reported.some((r) => r.where === "settings.atomic")).toBe(true);
  });
});

describe("updateSettingStamped — большие значения", () => {
  const db = () => fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });

  /** Какие значения уходят в условия запросов (в адрес запроса PostgREST). */
  function spy(inner: FakeDb) {
    const filters: string[] = [];
    const wrap = (q: object): object =>
      new Proxy(q, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv) as unknown;
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (prop === "eq" || prop === "is") filters.push(String(args[1]));
            const r = (v as (...a: unknown[]) => unknown).apply(target, args);
            return r && typeof r === "object" && r !== target ? r : wrap(target);
          };
        },
      });
    return { db: { from: (t: string) => wrap(inner.from(t)) }, filters };
  }

  it("условие записи — метка времени, а не значение: 30 КБ записываются и дописываются", async () => {
    const inner = db();
    const { db: spied, filters } = spy(inner);
    const ctx = ctxWith(spied);
    const big = "я".repeat(30_000);
    expect(await updateSettingStamped(ctx, "hw_x", () => big)).toBe("written");
    expect(await updateSettingStamped(ctx, "hw_x", (raw) => `${raw}!`)).toBe("written");
    expect(await getSetting(ctxWith(inner), "hw_x")).toBe(`${big}!`);
    expect(filters.length).toBeGreaterThan(0);
    expect(Math.max(...filters.map((f) => f.length))).toBeLessThan(100);
  });

  it("10 параллельных дописываний не теряются", async () => {
    const ctx = ctxWith(db());
    const add = (raw: string | null) =>
      JSON.stringify([...(JSON.parse(raw ?? "[]") as number[]), 1]);
    const res = await Promise.all(
      Array.from({ length: 10 }, () => updateSettingStamped(ctx, "hw_y", add, 50)),
    );
    expect(res.every((r) => r === "written")).toBe(true);
    expect(JSON.parse((await getSetting(ctx, "hw_y"))!)).toHaveLength(10);
  });
});
