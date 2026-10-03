import { afterEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  AI_BALANCE_KEY,
  aiBalance,
  aiCredit,
  aiJournal,
  aiRelease,
  aiReserve,
  aiSettle,
  type AiHold,
} from "./balance";
import { setAiMarkupSource } from "./markup";

/**
 * ИИ-баланс клиента (решение владельца 27.09): стартовые 5 $ один раз, каждый
 * вызов ИИ списывает цену API плюс наценку, параллельные вызовы не уводят в
 * минус, продавцу предупреждения «почти кончился» и «кончился» — по разу.
 */
const BOT = "11111111-1111-1111-1111-111111111111";

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: { id: BOT, settings: {}, modules: {}, ownerTelegramId: 42 },
    db,
  } as unknown as TenantContext;
  const balance = () =>
    JSON.parse(String(db.tables.app_settings!.find((r) => r.key === AI_BALANCE_KEY)!.value)) as {
      usd: number;
      low: boolean;
      empty: boolean;
    };
  const warnings = () => db.tables.zernio_logs!.map((r) => (r.payload as { text: string }).text);
  const setBalance = (usd: number) =>
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: AI_BALANCE_KEY,
      value: JSON.stringify({ usd, low: false, empty: false }),
    });
  return { db, ctx, balance, warnings, setBalance };
}

afterEach(() => setAiMarkupSource(async () => 0));

/** Бронь состоялась — иначе тест падает здесь, а не на undefined дальше. */
const ok = (h: AiHold | "short" | "failed"): AiHold => {
  if (typeof h === "string") throw new Error(`бронь не прошла: ${h}`);
  return h;
};

/** База, где любая запись в app_settings (update) отвечает ошибкой. */
function failingUpdates<T extends object>(db: T): T {
  const errChain = (): unknown => {
    const c: unknown = new Proxy(
      {},
      {
        get: (_, k) =>
          k === "then"
            ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: "boom" } })
            : () => c,
      },
    );
    return c;
  };
  return new Proxy(db, {
    get(t, k) {
      if (k !== "from") return Reflect.get(t, k);
      return (table: string) => {
        const b = (t as { from: (x: string) => object }).from(table);
        if (table !== "app_settings") return b;
        return new Proxy(b, {
          get: (bt, bk) => (bk === "update" ? errChain : Reflect.get(bt, bk)),
        });
      };
    },
  });
}

describe("ИИ-баланс клиента", () => {
  it("при подключении — 5 $ ровно один раз, в журнале одна запись", async () => {
    const { db, ctx } = setup();
    const all = await Promise.all([aiBalance(ctx), aiBalance(ctx), aiBalance(ctx)]);
    expect(all.map((b) => b.usd)).toEqual([5, 5, 5]);
    const ledger = db.tables.app_settings!.filter((r) => String(r.key).startsWith("ai_ledger:"));
    expect(ledger).toHaveLength(1);
    expect(JSON.parse(String(ledger[0]!.value))).toMatchObject({ kind: "start", usd: 5 });
  });

  it("бронь и расчёт: списана фактическая цена, расход дня по виду ИИ", async () => {
    const { db, ctx, balance } = setup();
    const hold = await aiReserve(ctx, "consultant", 0.03);
    expect(hold).toEqual({ use: "consultant", usd: 0.03 });
    expect(balance().usd).toBe(4.97);
    await aiSettle(ctx, ok(hold), 0.004);
    expect(balance().usd).toBe(4.996);
    const day = db.tables.app_settings!.find((r) => String(r.key).startsWith("ai_charges:"))!;
    expect(JSON.parse(String(day.value)).uses.consultant).toEqual({ usd: 0.004, calls: 1 });
  });

  it("наценка оператора: 50 % сверху к цене API и к брони", async () => {
    setAiMarkupSource(async () => 50);
    const { ctx, balance } = setup();
    const hold = await aiReserve(ctx, "assistant", 0.02);
    expect(ok(hold).usd).toBe(0.03);
    await aiSettle(ctx, ok(hold), 0.01);
    expect(balance().usd).toBe(4.985);
  });

  it("вызов не состоялся — бронь возвращается целиком", async () => {
    const { ctx, balance } = setup();
    const hold = await aiReserve(ctx, "smart_search", 0.08);
    await aiRelease(ctx, ok(hold));
    expect(balance().usd).toBe(5);
  });

  it("сто параллельных броней на 5 $ по 0,3 $ — прошло 16, баланс не в минусе", async () => {
    const { ctx, balance } = setup();
    await aiBalance(ctx);
    const holds = await Promise.all(
      Array.from({ length: 100 }, () => aiReserve(ctx, "consultant", 0.3)),
    );
    expect(holds.filter((h) => typeof h !== "string")).toHaveLength(16);
    expect(holds.filter((h) => h === "short")).toHaveLength(84);
    expect(balance().usd).toBeCloseTo(0.2, 6);
  });

  it("почти кончился и кончился — по одному предупреждению продавцу", async () => {
    const { ctx, balance, warnings, setBalance } = setup();
    setBalance(1.05);
    const a = await aiReserve(ctx, "consultant", 0.03);
    await aiSettle(ctx, ok(a), 0.1);
    expect(balance()).toMatchObject({ usd: 0.95, low: true, empty: false });
    const b = await aiReserve(ctx, "consultant", 0.03);
    await aiSettle(ctx, ok(b), 0.01);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("почти закончился");

    // Бронь больше остатка — ИИ не зовём, «кончился» один раз; деньги не трогаем.
    expect(await aiReserve(ctx, "consultant", 5)).toBe("short");
    expect(await aiReserve(ctx, "consultant", 5)).toBe("short");
    expect(balance()).toMatchObject({ usd: 0.94, empty: true });
    expect(warnings()).toHaveLength(2);
    expect(warnings()[1]).toContain("закончился");
  });

  it("предупреждение продавцу — на языке его админки", async () => {
    const { ctx, warnings, setBalance, db } = setup();
    db.tables.app_settings!.push({ bot_id: BOT, key: "admin_locale", value: "kk" });
    setBalance(1.05);
    const a = await aiReserve(ctx, "consultant", 0.03);
    await aiSettle(ctx, ok(a), 0.1);
    expect(warnings()[0]).toContain("ЖИ-баланс таусылуға жақын");
    expect(await aiReserve(ctx, "consultant", 5)).toBe("short");
    expect(warnings()[1]).toContain("ЖИ-баланс таусылды");
  });

  it("пополнение снимает предупреждения; снять больше остатка нельзя; журнал", async () => {
    const { ctx, balance, setBalance } = setup();
    setBalance(0.5);
    expect(await aiReserve(ctx, "consultant", 1)).toBe("short");
    expect(balance().empty).toBe(true);
    const after = await aiCredit(ctx, {
      kind: "topup",
      usd: 10,
      note: "Kaspi",
      invoiceId: "inv-1",
    });
    expect(after).toMatchObject({ usd: 10.5, low: false, empty: false });
    expect(await aiCredit(ctx, { kind: "adjust", usd: -11, actor: "operator" })).toBeNull();
    expect(await aiCredit(ctx, { kind: "adjust", usd: -0.5, actor: "operator" })).toMatchObject({
      usd: 10,
    });
    const h = await aiReserve(ctx, "receipt_ocr", 0.0015);
    await aiSettle(ctx, ok(h), 0.0015);
    const j = await aiJournal(ctx);
    expect(j.map((r) => (r.type === "ledger" ? r.kind : r.use)).sort()).toEqual(
      ["adjust", "receipt_ocr", "topup"].sort(),
    );
  });

  it("тот же счёт второй раз не зачисляется; память о счетах переживает брони", async () => {
    const { ctx, balance, db, setBalance } = setup();
    setBalance(1);
    await aiCredit(ctx, { kind: "topup", usd: 10, invoiceId: "inv-7" });
    const h = await aiReserve(ctx, "consultant", 0.5);
    await aiSettle(ctx, ok(h), 0.5);
    expect(await aiCredit(ctx, { kind: "topup", usd: 10, invoiceId: "inv-7" })).toMatchObject({
      usd: 10.5,
    });
    expect(balance().usd).toBeCloseTo(10.5, 6);
    const topups = db.tables.app_settings!.filter((r) =>
      String(r.value).includes('"kind":"topup"'),
    );
    expect(topups).toHaveLength(1);
    // Другой счёт — зачисляется.
    await aiCredit(ctx, { kind: "topup", usd: 5, invoiceId: "inv-8" });
    expect(balance().usd).toBeCloseTo(15.5, 6);
  });

  it("сбой базы при брони — «failed», а не «кончился»: ни флага, ни предупреждения", async () => {
    const { db, ctx, balance, warnings } = setup();
    await aiBalance(ctx);
    const broken = { ...ctx, db: failingUpdates(db) } as unknown as TenantContext;
    expect(await aiReserve(broken, "consultant", 0.03)).toBe("failed");
    expect(balance()).toEqual({ usd: 5, low: false, empty: false });
    expect(warnings()).toHaveLength(0);
  });

  it("испорченное значение баланса — бронь «failed»", async () => {
    const { db, ctx } = setup();
    db.tables.app_settings!.push({ bot_id: BOT, key: AI_BALANCE_KEY, value: "не json" });
    expect(await aiReserve(ctx, "consultant", 0.03)).toBe("failed");
  });

  it("сбой базы при поправке — serverFailure, а не «списать нельзя»", async () => {
    const { db, ctx } = setup();
    await aiBalance(ctx);
    const broken = { ...ctx, db: failingUpdates(db) } as unknown as TenantContext;
    const { isPlatformFailure } = await import("@/lib/server-fn-errors");
    const err = await aiCredit(broken, { kind: "adjust", usd: 1, note: "x" }).catch((e) => e);
    expect(isPlatformFailure(err)).toBe(true);
  });
});
