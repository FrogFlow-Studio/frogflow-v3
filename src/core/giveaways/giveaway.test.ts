import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isUserError } from "@/core/i18n/user-error";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const {
  GIVEAWAY_INDEX_KEY,
  GIVEAWAY_MAX,
  closeGiveaway,
  createGiveaway,
  getGiveaway,
  giveawayKey,
  listGiveaways,
  newGiveawayId,
  parseGiveaway,
  updateGiveaway,
  validateGiveawayInput,
} = await import("./giveaway");

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const ctxOf = (db = fakeDb()) => ({
  ctx: { tenant: { id: BOT }, db } as unknown as TenantContext,
  db,
});

const input = (patch: Partial<Parameters<typeof validateGiveawayInput>[0]> = {}) => ({
  title: "Розыгрыш к осени",
  prize: "Набор открыток",
  channel: "telegram" as const,
  conditions: "Подписка на канал",
  endsAt: "2026-10-11T10:00:00.000Z",
  winners: 2,
  subscribeChannel: "",
  excludeBlocked: true,
  excludeStaff: true,
  ...patch,
});

async function keyOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (isUserError(e)) return (e as { key: string }).key;
    throw e;
  }
  throw new Error("ожидали отказ");
}

describe("проверка формы розыгрыша", () => {
  it("принимает нормальную форму и приводит срок к ISO", () => {
    const v = validateGiveawayInput(
      input({ title: "  Осень  ", endsAt: "2026-10-11T15:00:00+05:00" }),
      NOW,
    );
    expect(v.title).toBe("Осень");
    expect(v.endsAt).toBe("2026-10-11T10:00:00.000Z");
  });

  it.each([
    [{ title: "  " }, "err.giveaway.titleRequired"],
    [{ title: "я".repeat(81) }, "err.giveaway.titleLong"],
    [{ prize: "" }, "err.giveaway.prizeRequired"],
    [{ prize: "я".repeat(201) }, "err.giveaway.prizeLong"],
    [{ conditions: "я".repeat(1001) }, "err.giveaway.conditionsLong"],
    [{ channel: "vk" as never }, "err.giveaway.badChannel"],
    [{ endsAt: "завтра" }, "err.giveaway.badDate"],
    [{ endsAt: "2026-10-04T10:00:00.000Z" }, "err.giveaway.datePast"],
    [{ endsAt: "2027-10-05T10:00:00.000Z" }, "err.giveaway.dateFar"],
    [{ winners: 0 }, "err.giveaway.badWinners"],
    [{ winners: 51 }, "err.giveaway.badWinners"],
    [{ winners: 1.5 }, "err.giveaway.badWinners"],
    [{ subscribeChannel: "канал" }, "err.giveaway.badSubChannel"],
    [{ subscribeChannel: "-1001234567890" }, "err.giveaway.badSubChannel"],
  ])("отказывает: %j", (patch, key) => {
    let got = "";
    try {
      validateGiveawayInput(input(patch), NOW);
    } catch (e) {
      got = (e as { key: string }).key;
    }
    expect(got).toBe(key);
  });

  it("канал подписки: пусто или публичный @имя", () => {
    expect(
      validateGiveawayInput(input({ subscribeChannel: " @my_shop " }), NOW).subscribeChannel,
    ).toBe("@my_shop");
    expect(validateGiveawayInput(input(), NOW).subscribeChannel).toBe("");
  });

  it("срок ровно через год допустим, на минуту позже — нет", () => {
    expect(() =>
      validateGiveawayInput(input({ endsAt: "2027-10-04T10:00:00.000Z" }), NOW),
    ).not.toThrow();
    expect(() =>
      validateGiveawayInput(input({ endsAt: "2027-10-04T10:01:00.000Z" }), NOW),
    ).toThrow();
  });
});

describe("сохранение розыгрыша", () => {
  it("создаёт: розыгрыш и его id в списке, версия 1, приём идёт", async () => {
    const { ctx, db } = ctxOf();
    const g = await createGiveaway(ctx, input(), NOW);
    expect(g).toMatchObject({ rev: 1, status: "open", title: "Розыгрыш к осени", winners: 2 });
    const rows = db.tables.app_settings!;
    expect(rows.map((r) => r.key).sort()).toEqual([GIVEAWAY_INDEX_KEY, giveawayKey(g.id)].sort());
    expect(JSON.parse(rows.find((r) => r.key === GIVEAWAY_INDEX_KEY)!.value as string)).toEqual([
      g.id,
    ]);
    expect(await getGiveaway(ctx, g.id)).toEqual(g);
  });

  it("список: новые сверху, одинаковое время — по id", async () => {
    const { ctx } = ctxOf();
    const a = await createGiveaway(ctx, input({ title: "A" }), NOW);
    const b = await createGiveaway(ctx, input({ title: "B" }), new Date(NOW.getTime() + 1000));
    const c = await createGiveaway(ctx, input({ title: "C" }), new Date(NOW.getTime() + 1000));
    const ids = (await listGiveaways(ctx)).map((g) => g.id);
    const tied = [b.id, c.id].sort().reverse();
    expect(ids).toEqual([...tied, a.id]);
  });

  it("список длиннее 200 читается кусками и ничего не теряет", async () => {
    const db = fakeDb({ maxIn: 200 });
    const { ctx } = ctxOf(db);
    const ids: string[] = [];
    for (let i = 0; i < 230; i++) {
      const id = `g${String(i).padStart(7, "0")}`;
      ids.push(id);
      const g = {
        ...input(),
        id,
        rev: 1,
        status: "open",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      };
      db.tables.app_settings = [
        ...(db.tables.app_settings ?? []),
        { bot_id: BOT, key: giveawayKey(id), value: JSON.stringify(g) },
      ];
    }
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: GIVEAWAY_INDEX_KEY,
      value: JSON.stringify(ids),
    });
    expect(await listGiveaways(ctx)).toHaveLength(230);
  });

  it("лимит розыгрышей на магазин", async () => {
    const { ctx, db } = ctxOf();
    const ids = Array.from({ length: GIVEAWAY_MAX }, (_, i) => `x${String(i).padStart(7, "0")}`);
    db.tables.app_settings = [{ bot_id: BOT, key: GIVEAWAY_INDEX_KEY, value: JSON.stringify(ids) }];
    expect(await keyOf(createGiveaway(ctx, input(), NOW))).toBe("err.giveaway.limit");
  });

  it("плохая форма ничего не пишет", async () => {
    const { ctx, db } = ctxOf();
    expect(await keyOf(createGiveaway(ctx, input({ winners: 0 }), NOW))).toBe(
      "err.giveaway.badWinners",
    );
    expect(db.tables.app_settings ?? []).toEqual([]);
  });

  it("правка: версия растёт, id и дата создания остаются", async () => {
    const { ctx } = ctxOf();
    const g = await createGiveaway(ctx, input(), NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const u = await updateGiveaway(ctx, g.id, 1, input({ prize: "Сертификат", winners: 3 }), later);
    expect(u).toMatchObject({
      id: g.id,
      rev: 2,
      prize: "Сертификат",
      winners: 3,
      createdAt: g.createdAt,
    });
    expect(u.updatedAt).toBe(later.toISOString());
  });

  it("правка с чужой версией отклонена и не меняет запись", async () => {
    const { ctx } = ctxOf();
    const g = await createGiveaway(ctx, input(), NOW);
    await updateGiveaway(ctx, g.id, 1, input({ prize: "Первое окно" }), NOW);
    expect(await keyOf(updateGiveaway(ctx, g.id, 1, input({ prize: "Второе окно" }), NOW))).toBe(
      "err.giveaway.stale",
    );
    expect((await getGiveaway(ctx, g.id))?.prize).toBe("Первое окно");
  });

  it("два окна правят одновременно с одной версией — проходит ровно одно", async () => {
    const { ctx } = ctxOf();
    const g = await createGiveaway(ctx, input(), NOW);
    const res = await Promise.allSettled([
      updateGiveaway(ctx, g.id, 1, input({ prize: "A" }), NOW),
      updateGiveaway(ctx, g.id, 1, input({ prize: "B" }), NOW),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const cur = await getGiveaway(ctx, g.id);
    expect(cur?.rev).toBe(2);
  });

  it("правка несуществующего и закрытого розыгрыша", async () => {
    const { ctx } = ctxOf();
    expect(await keyOf(updateGiveaway(ctx, "abcdefgh", 1, input(), NOW))).toBe(
      "err.giveaway.notFound",
    );
    const g = await createGiveaway(ctx, input(), NOW);
    const closed = await closeGiveaway(ctx, g.id, NOW);
    expect(await keyOf(updateGiveaway(ctx, g.id, closed.rev, input(), NOW))).toBe(
      "err.giveaway.notOpen",
    );
  });

  it("закрытие приёма: один раз меняет версию, повтор ничего не меняет", async () => {
    const { ctx } = ctxOf();
    const g = await createGiveaway(ctx, input(), NOW);
    const first = await closeGiveaway(ctx, g.id, NOW);
    expect(first).toMatchObject({ status: "closed", rev: 2 });
    const again = await closeGiveaway(ctx, g.id, new Date(NOW.getTime() + 5000));
    expect(again).toMatchObject({ status: "closed", rev: 2 });
    expect(await keyOf(closeGiveaway(ctx, "abcdefgh", NOW))).toBe("err.giveaway.notFound");
  });
});

describe("чтение", () => {
  it("сбой базы при чтении — ошибка, а не «розыгрышей нет»", async () => {
    const { ctx } = ctxOf({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    } as never);
    await expect(listGiveaways(ctx)).rejects.toThrow();
    await expect(getGiveaway(ctx, "abcdefgh")).rejects.toThrow();
  });

  it("битая запись не роняет список и не считается розыгрышем", () => {
    expect(parseGiveaway("{не json")).toBeNull();
    expect(parseGiveaway(JSON.stringify({ id: "!", endsAt: "2026-10-11T10:00:00Z" }))).toBeNull();
    expect(parseGiveaway(null)).toBeNull();
  });

  it("id — 8 символов a–z0–9", () => {
    expect(newGiveawayId()).toMatch(/^[a-z0-9]{8}$/);
  });
});
