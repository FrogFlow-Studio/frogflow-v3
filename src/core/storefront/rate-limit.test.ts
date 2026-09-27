import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const {
  COURSE_BUDGET,
  MINI_APP_BUDGETS,
  RATE_LIMIT_PREFIX,
  nextCounter,
  rateLimitKey,
  rateLimiter,
  takeCourse,
  takeShared,
} = await import("./rate-limit");

const B = { limit: 3, windowMs: 60_000 };

describe("лимит частоты Mini App", () => {
  it("пачка оформлений упирается в лимит у каждого покупателя отдельно", () => {
    const l = rateLimiter();
    const t = 1_000;
    expect([1, 2, 3, 4].map(() => l.take("bot:1:checkout", B, t))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // Сосед по магазину и тот же покупатель в другом магазине — свои бюджеты.
    expect(l.take("bot:2:checkout", B, t)).toBe(true);
    expect(l.take("other:1:checkout", B, t)).toBe(true);
  });

  it("оформление и «Мои заказы» не делят один бюджет", () => {
    const l = rateLimiter();
    for (let i = 0; i < 3; i++) l.take("bot:1:checkout", B, 0);
    expect(l.take("bot:1:checkout", B, 0)).toBe(false);
    expect(l.take("bot:1:orders", B, 0)).toBe(true);
  });

  it("окно скользит: старые попытки перестают считаться", () => {
    const l = rateLimiter();
    for (let i = 0; i < 3; i++) l.take("k", B, i * 1_000);
    expect(l.take("k", B, 59_999)).toBe(false);
    // Первая попытка (t=0) вышла из окна — место освободилось одно.
    expect(l.take("k", B, 60_000)).toBe(true);
    expect(l.take("k", B, 60_001)).toBe(false);
  });

  it("отказ не продлевает паузу: долбёжка не запирает покупателя навсегда", () => {
    const l = rateLimiter();
    for (let i = 0; i < 3; i++) l.take("k", B, 0);
    for (let t = 1; t < 60_000; t += 5_000) l.take("k", B, t);
    expect(l.take("k", B, 60_000)).toBe(true);
  });

  it("память ограничена: при переполнении старые ключи вытесняются", () => {
    const l = rateLimiter(2);
    l.take("a", B, 0);
    l.take("b", B, 0);
    l.take("c", B, 0);
    expect(l.size()).toBe(2);
  });

  it("у оформления бюджет строже, чем у просмотра заказов", () => {
    expect(MINI_APP_BUDGETS.checkout.limit).toBeLessThan(MINI_APP_BUDGETS.orders.limit);
  });
});

const BOT = "11111111-1111-1111-1111-111111111111";
const ctxWith = (db: unknown, id = BOT) => ({ tenant: { id }, db }) as unknown as TenantContext;
const sharedDb = () => fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });

describe("счётчик общего лимита", () => {
  const W = 60_000;
  const b = { limit: 3, windowMs: W };
  const run = (raw: string | null, times: number[]) => {
    const out: boolean[] = [];
    for (const t of times) {
      const next = nextCounter(raw, b, t);
      out.push(next != null);
      if (next != null) raw = next;
    }
    return { out, raw };
  };

  it("в одном окне пропускает ровно limit, отказ не засчитывается", () => {
    const { out, raw } = run(null, [0, 1, 2, 3, 4]);
    expect(out).toEqual([true, true, true, false, false]);
    expect(JSON.parse(raw!)).toEqual({ w: 0, c: 3, p: 0 });
  });

  it("прошлое окно учитывается с весом: на стыке окон лимит не удваивается", () => {
    const { raw } = run(null, [W - 3, W - 2, W - 1]);
    // Сразу после смены окна прошлые 3 попытки ещё почти целиком в последней минуте.
    expect(nextCounter(raw, b, W + 1)).toBeNull();
    // К концу нового окна их вес уходит — место освобождается.
    expect(nextCounter(raw, b, 2 * W - 1)).not.toBeNull();
  });

  it("окно старше предыдущего и битое значение — счёт с нуля", () => {
    const { raw } = run(null, [0, 1, 2]);
    expect(JSON.parse(nextCounter(raw, b, 3 * W)!)).toEqual({ w: 3 * W, c: 1, p: 0 });
    expect(JSON.parse(nextCounter("мусор", b, 5)!)).toEqual({ w: 0, c: 1, p: 0 });
    expect(JSON.parse(nextCounter('{"w":-1,"c":9,"p":0}', b, 5)!)).toEqual({ w: 0, c: 1, p: 0 });
  });

  it("часы другого экземпляра спешат — считаем в его окне, а не обнуляем", () => {
    const { raw } = run(null, [W, W, W]);
    expect(nextCounter(raw, b, W - 10)).toBeNull();
  });
});

describe("общий лимит в базе", () => {
  const b = { limit: 3, windowMs: 60_000 };

  it("экземпляры с пустой памятью делят один счёт из базы", async () => {
    const db = sharedDb();
    const ctx = ctxWith(db);
    // Каждый запрос — «новый экземпляр»: своя пустая память.
    const res = [];
    for (let i = 0; i < 5; i++)
      res.push(await takeShared(ctx, "k", "tg_1", b, rateLimiter(), 1_000));
    expect(res).toEqual([true, true, true, false, false]);
    expect(db.tables.app_settings!.map((r) => [r.bot_id, r.key])).toEqual([
      [BOT, rateLimitKey("k", "tg_1")],
    ]);
    expect(String(db.tables.app_settings![0]!.key).startsWith(RATE_LIMIT_PREFIX)).toBe(true);
    // Дата записи есть — по ней ночная уборка находит старые счётчики.
    expect(db.tables.app_settings![0]!.updated_at).toEqual(expect.any(String));
  });

  it("параллельная пачка не проскакивает мимо лимита", async () => {
    const ctx = ctxWith(sharedDb());
    const res = await Promise.all(
      Array.from({ length: 12 }, () => takeShared(ctx, "k", "tg_1", b, rateLimiter(), 1_000)),
    );
    expect(res.filter(Boolean)).toHaveLength(3);
  });

  it("соседи, виды и магазины считаются отдельно", async () => {
    const db = sharedDb();
    for (let i = 0; i < 3; i++) await takeShared(ctxWith(db), "k", "tg_1", b, rateLimiter(), 0);
    expect(await takeShared(ctxWith(db), "k", "tg_1", b, rateLimiter(), 0)).toBe(false);
    expect(await takeShared(ctxWith(db), "k", "tg_2", b, rateLimiter(), 0)).toBe(true);
    expect(await takeShared(ctxWith(db), "other", "tg_1", b, rateLimiter(), 0)).toBe(true);
  });

  it("база не отвечает — решает счёт в памяти экземпляра", async () => {
    const broken = {
      from: () => {
        throw new Error("fetch failed");
      },
    };
    const local = rateLimiter();
    const res = [];
    for (let i = 0; i < 4; i++)
      res.push(await takeShared(ctxWith(broken), "k", "tg_1", b, local, 0));
    expect(res).toEqual([true, true, true, false]);
  });

  it("база отвечает ошибкой — тоже запасной счёт, покупатель не заперт", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "timeout" } }),
          }),
        }),
      }),
    };
    expect(await takeShared(ctxWith(db), "k", "tg_1", b, rateLimiter(), 0)).toBe(true);
  });

  it("память отказала — в базу не ходим", async () => {
    const db = sharedDb();
    const local = rateLimiter();
    for (let i = 0; i < 3; i++) await takeShared(ctxWith(db), "k", "tg_1", b, local, 0);
    const from = vi.spyOn(db, "from");
    expect(await takeShared(ctxWith(db), "k", "tg_1", b, local, 0)).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("лимит частоты страницы курса", () => {
  it("одна покупка не подписывает файлы без конца; другая покупка считается отдельно", async () => {
    const db = sharedDb();
    const ctx = ctxWith(db, "bot-course");
    for (let i = 0; i < COURSE_BUDGET.limit; i++)
      expect(await takeCourse(ctx, "item-1")).toBe(true);
    expect(await takeCourse(ctx, "item-1")).toBe(false);
    expect(await takeCourse(ctx, "item-2")).toBe(true);
    expect(await takeCourse(ctxWith(sharedDb(), "other-bot"), "item-1")).toBe(true);
  });
});
