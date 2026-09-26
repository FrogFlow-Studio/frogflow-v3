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

const { setSetting, trySetSetting, getSetting } = await import("./settings");

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
