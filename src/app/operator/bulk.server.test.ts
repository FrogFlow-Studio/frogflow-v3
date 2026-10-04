import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/config/env", () => ({ env: () => ({ APP_TIMEZONE: "Asia/Almaty" }) }));
const payments: Array<Record<string, unknown>> = [];
let expires: string | null = null;
vi.mock("./billing.server", () => ({
  subscriptionExpiresAt: async () => expires,
  addPayment: async (_id: string, p: Record<string, unknown>) => {
    payments.push(p);
    return { expiresAt: null };
  },
}));

const { runBulk, claimMark, extendTenant } = await import("./bulk.server");
type Deps = Parameters<typeof runBulk>[1];
type Input = Parameters<typeof runBulk>[0];

const tenant = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: `Клиент ${id}`,
    archived: false,
    telegramTokenEnc: "enc",
    modules: {},
    settings: { served_by: "v2" },
    ...over,
  }) as unknown as Tenant;

const TENANTS = [
  tenant("a"),
  tenant("b"),
  tenant("v1", { settings: { served_by: "v1" } }),
  tenant("arch", { archived: true }),
  tenant("notg", { telegramTokenEnc: null }),
];

let sent: string[];
let extended: string[];
let enabled: string[];
let logged: Array<Record<string, unknown>>;
let clock: number;
let deliverReason: string | null;

const deps = (over: Partial<NonNullable<Deps>> = {}): NonNullable<Deps> => ({
  tenants: async () => TENANTS,
  claim: claimMark,
  sendMessage: async (id) => {
    await Promise.resolve();
    sent.push(id);
    return { delivered: deliverReason ? 0 : 1, reason: deliverReason };
  },
  extend: async (t) => {
    extended.push(t.id);
    return "продлено";
  },
  enableModule: async (id) => void enabled.push(id),
  log: async (_id, p) => void logged.push(p),
  now: () => clock,
  day: () => "2026-10-04",
  ...over,
});

const input = (over: Partial<Input> = {}): Input => ({
  botIds: ["a", "b", "v1", "arch", "notg"],
  action: { kind: "message", text: "Привет" },
  batchId: "11111111-1111-1111-1111-111111111111",
  confirmCount: "5",
  actor: "op",
  ...over,
});

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  sent = [];
  extended = [];
  enabled = [];
  logged = [];
  payments.length = 0;
  expires = null;
  clock = 1_000_000;
  deliverReason = null;
});

const by = (r: Awaited<ReturnType<typeof runBulk>>) =>
  Object.fromEntries(r.results.map((x) => [x.botId, x.status]));

describe("массовые действия оператора: границы", () => {
  it("число клиентов вводится верно, иначе ничего не происходит", async () => {
    await expect(runBulk(input({ confirmCount: "4" }), deps())).rejects.toThrow(/число клиентов/);
    await expect(runBulk(input({ confirmCount: "" }), deps())).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("больше потолка — отказ, а не молчаливая обрезка", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `x${i}`);
    await expect(runBulk(input({ botIds: ids, confirmCount: "501" }), deps())).rejects.toThrow(
      /не больше 500/,
    );
  });

  it("клиенты v1, архивные и без бота пропущены с причиной, v2 — сделаны", async () => {
    const r = await runBulk(input(), deps());
    expect(by(r)).toEqual({
      a: "done",
      b: "done",
      v1: "skipped",
      arch: "skipped",
      notg: "skipped",
    });
    expect(sent.sort()).toEqual(["a", "b"]);
    expect(r.results.find((x) => x.botId === "v1")?.note).toContain("v1");
  });

  it("у каждого сделанного — запись для журнала клиента", async () => {
    await runBulk(input(), deps());
    expect(logged).toEqual([
      { bulk: "message", batch: "11111111-1111-1111-1111-111111111111" },
      { bulk: "message", batch: "11111111-1111-1111-1111-111111111111" },
    ]);
  });

  it("недоставленное — «ошибка», не «сделано»", async () => {
    deliverReason = "бот заблокирован";
    const r = await runBulk(input(), deps());
    expect(by(r).a).toBe("failed");
    expect(r.results[0]!.note).toContain("бот заблокирован");
    expect(logged).toEqual([]);
  });

  it("вышел бюджет времени — остальные «отложены», не пропадают", async () => {
    const many = Array.from({ length: 6 }, (_, i) => tenant(`m${i}`));
    const d = deps({
      tenants: async () => many,
      sendMessage: async (id) => {
        clock += 200_000;
        sent.push(id);
        return { delivered: 1, reason: null };
      },
    });
    const r = await runBulk(input({ botIds: many.map((t) => t.id), confirmCount: "6" }), d);
    const st = Object.values(by(r));
    expect(st.filter((x) => x === "done")).toHaveLength(4);
    expect(st.filter((x) => x === "deferred")).toHaveLength(2);
    expect(sent).toHaveLength(4);
  });
});

describe("«один раз»", () => {
  it("два запуска одновременно: каждому клиенту сообщение уходит один раз за день", async () => {
    await Promise.all([runBulk(input(), deps()), runBulk(input(), deps())]);
    expect(sent.sort()).toEqual(["a", "b"]);
  });

  it("на следующий день клиенту снова можно написать", async () => {
    await runBulk(input(), deps());
    await runBulk(input(), deps({ day: () => "2026-10-05" }));
    expect(sent.sort()).toEqual(["a", "a", "b", "b"]);
  });

  it("продление: повтор того же запуска не продлевает второй раз, новый запуск — продлевает", async () => {
    const action = { kind: "extend", days: 7 } as const;
    await Promise.all([runBulk(input({ action }), deps()), runBulk(input({ action }), deps())]);
    expect(extended.sort()).toEqual(["a", "b", "notg"]);
    await runBulk(input({ action, batchId: "22222222-2222-2222-2222-222222222222" }), deps());
    expect(extended.sort()).toEqual(["a", "a", "b", "b", "notg", "notg"]);
  });

  it("метка для длинного адреса короткая: ключ и значение малы", async () => {
    await runBulk(input(), deps());
    for (const r of db.tables.app_settings ?? []) {
      expect(String(r.key).length).toBeLessThan(80);
      expect(String(r.value).length).toBeLessThan(40);
    }
  });
});

describe("продлить тариф и включить модуль", () => {
  it("платящему — платёж на 0 ₸ вплотную к сроку; клиенту без срока — ошибка в отчёте", async () => {
    // Настоящий путь продления: подменён только слой платежей.
    const d = deps({ extend: extendTenant });
    const action = { kind: "extend", days: 7 } as const;
    expires = "2099-01-10T00:00:00Z";
    const r = await runBulk(input({ botIds: ["a"], confirmCount: "1", action }), d);
    expect(by(r).a).toBe("done");
    expect(payments).toEqual([
      expect.objectContaining({
        period_start: "2099-01-11",
        period_end: "2099-01-17",
        amount: 0,
        currency: "KZT",
      }),
    ]);
    expires = null;
    const r2 = await runBulk(input({ botIds: ["b"], confirmCount: "1", action }), d);
    expect(by(r2).b).toBe("failed");
    expect(payments).toHaveLength(1);
  });

  it("модуль: включённый пропускается, ошибка зависимости попадает в отчёт", async () => {
    const t = [tenant("a", { modules: { loyalty: true } }), tenant("b")];
    const d = deps({
      tenants: async () => t,
      enableModule: async (id) => {
        if (id === "b") throw new Error("Сначала включите «Магазин».");
        enabled.push(id);
      },
    });
    const r = await runBulk(
      input({
        botIds: ["a", "b"],
        confirmCount: "2",
        action: { kind: "module", module: "loyalty" },
      }),
      d,
    );
    expect(by(r)).toEqual({ a: "skipped", b: "failed" });
    expect(r.results[1]!.note).toContain("Сначала включите");
  });
});
