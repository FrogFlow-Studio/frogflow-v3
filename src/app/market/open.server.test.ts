import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { OpenRequest } from "@/core/marketplace/open-request";

/** Заявка «Открыть свой магазин»: настоящий insertLead на подставной базе. */
let db: FakeDb;
let failLeadInsert = false;
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => {
    const real = db.from.bind(db);
    return {
      from: (t: string) => {
        const q = real(t) as unknown as Record<string, unknown>;
        if (t !== "sales_leads" || !failLeadInsert) return q;
        return new Proxy(q, {
          get: (target, key) =>
            key === "insert"
              ? () => ({
                  select: () => ({
                    single: async () => ({ data: null, error: { message: "boom" } }),
                  }),
                })
              : (target[key as string] as (...a: unknown[]) => unknown).bind(target),
        });
      },
    };
  },
}));

const { submitOpenRequest } = await import("./open.server");

const REQ: OpenRequest = {
  vertical: "confectionery",
  tier: "pro",
  locale: "ru",
  businessName: "Сладкая Лавка",
  phone: "77001234567",
  email: null,
  instagramHandle: null,
  city: "Алматы",
  comment: null,
};
const other = (n: number): OpenRequest => ({ ...REQ, phone: `7700123456${n}` });
const leads = () => db.tables.sales_leads ?? [];
/** DEFAULT now() у created_at: подставная база его не ставит. */
const stamp = () => {
  for (const l of leads()) l.created_at ??= new Date().toISOString();
};

beforeEach(() => {
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  failLeadInsert = false;
});

describe("заявка с площадки", () => {
  it("становится лидом «Новый» с ишей, тарифом и источником площадки", async () => {
    const r = await submitOpenRequest(REQ, "a".repeat(32));
    expect(r).toEqual({ status: "created" });
    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({
      business_name: "Сладкая Лавка",
      niche: "Кондитерская",
      city: "Алматы",
      phone: "77001234567",
      source: "market_open",
      stage: "new",
    });
    expect(String(leads()[0]!.signals)).toMatch(/^\[ff-open v=confectionery t=pro l=ru\]/);
    expect(String(leads()[0]!.created_by)).toMatch(/^market:/);
    expect(db.tables.sales_lead_events).toHaveLength(1);
  });

  it("повтор с тем же контактом в сутки лида не плодит", async () => {
    await submitOpenRequest(REQ, "a".repeat(32));
    expect(await submitOpenRequest(REQ, "b".repeat(32))).toEqual({ status: "duplicate" });
    expect(leads()).toHaveLength(1);
  });

  it("двойной клик: две одновременные заявки — один лид", async () => {
    const [x, y] = await Promise.all([
      submitOpenRequest(REQ, "a".repeat(32)),
      submitOpenRequest(REQ, "a".repeat(32)),
    ]);
    expect([x.status, y.status].sort()).toEqual(["created", "duplicate"]);
    expect(leads()).toHaveLength(1);
  });

  it("контакт уже есть в воронке — нового лида нет, у старого событие", async () => {
    db.tables.sales_leads = [
      { id: "old", business_name: "Лавка (из поиска)", phone: "77001234567", source: "hunt" },
    ];
    expect(await submitOpenRequest(REQ, "a".repeat(32))).toEqual({ status: "duplicate" });
    expect(leads()).toHaveLength(1);
    expect(db.tables.sales_lead_events).toEqual([
      expect.objectContaining({ lead_id: "old", kind: "market_repeat" }),
    ]);
  });

  it("с одного адреса не больше трёх в сутки, с другого можно", async () => {
    const ip = "c".repeat(32);
    for (let i = 1; i <= 3; i++) {
      expect((await submitOpenRequest(other(i), ip)).status).toBe("created");
      stamp();
    }
    expect(await submitOpenRequest(other(4), ip)).toEqual({ status: "refused", reason: "ip" });
    expect((await submitOpenRequest(other(5), "d".repeat(32))).status).toBe("created");
    expect(leads()).toHaveLength(4);
  });

  it("общий предел за сутки", async () => {
    db.tables.sales_leads = Array.from({ length: 40 }, (_, i) => ({
      id: `l${i}`,
      source: "market_open",
      created_by: `market:x${i}`,
      created_at: new Date().toISOString(),
    }));
    expect(await submitOpenRequest(REQ, "e".repeat(32))).toEqual({
      status: "refused",
      reason: "total",
    });
  });

  it("сбой записи лида снимает бронь — повторить можно сразу", async () => {
    failLeadInsert = true;
    await expect(submitOpenRequest(REQ, "a".repeat(32))).rejects.toThrow(/лид не сохранён/);
    expect(db.tables.operator_settings ?? []).toHaveLength(0);
    failLeadInsert = false;
    expect(await submitOpenRequest(REQ, "a".repeat(32))).toEqual({ status: "created" });
  });

  it("не удалось прочитать лимиты — ошибка, а не «можно»", async () => {
    db = withBrokenReads(db, ["sales_leads"]);
    await expect(submitOpenRequest(REQ, "a".repeat(32))).rejects.toThrow(/лимиты не прочитаны/);
    expect(db.tables.sales_leads ?? []).toHaveLength(0);
  });
});
