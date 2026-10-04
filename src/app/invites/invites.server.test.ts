import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests, env } from "@/config/env";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { inviteToken } from "@/core/invites/invites";

/** Ссылка-приглашение при регистрации и сводка для автора. База — в памяти. */
let db: FakeDb;
let dir: Array<Record<string, unknown>>;
const patches: Array<[string, Record<string, unknown>]> = [];
const A = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const B = "0bac1f86-5231-4e57-838d-2faa44d427e7";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  tenantDirectory: async () => dir,
  patchTenantSettings: async (id: string, p: Record<string, unknown>) => {
    patches.push([id, p]);
  },
}));

const { inviterForSignup, recordInvite, inviteCard, paidShops } = await import("./invites.server");

beforeEach(() => {
  setEnvForTests({});
  patches.length = 0;
  db = fakeDb({ maxRows: 1000, maxIn: 200 });
  db.tables.subscription_payments = [];
  dir = [
    { id: A, name: "Пригласивший", archived: false, settings: { served_by: "v2" } },
    { id: B, name: "Клиент v1", archived: false, settings: { served_by: "v1" } },
  ];
});

describe("регистрация по ссылке-приглашению", () => {
  it("настоящий токен живого магазина на v2 — пригласивший найден", async () => {
    expect(await inviterForSignup(inviteToken(env().SESSION_SECRET, A))).toBe(A);
  });

  it("подделка, чужой секрет, магазин прежней платформы и архивный — приглашения нет", async () => {
    expect(await inviterForSignup(inviteToken("другой-секрет-другой-секрет-1234", A))).toBeNull();
    expect(await inviterForSignup(`${A}.подделка`)).toBeNull();
    expect(await inviterForSignup(null)).toBeNull();
    expect(await inviterForSignup(inviteToken(env().SESSION_SECRET, B))).toBeNull();
    dir[0]!.archived = true;
    expect(await inviterForSignup(inviteToken(env().SESSION_SECRET, A))).toBeNull();
  });

  it("приглашение записывается новому магазину; сам на себя — нет", async () => {
    await recordInvite(B, A, new Date("2026-10-04T10:00:00Z"));
    expect(patches).toEqual([[B, { invite: { by: A, at: "2026-10-04T10:00:00.000Z" } }]]);
    await recordInvite(A, A);
    expect(patches).toHaveLength(1);
  });
});

describe("карточка «Пригласить автора»", () => {
  it("ссылка своя, сводка без имён; чужие приглашённые не считаются; оплата — по платежам", async () => {
    const ids = Array.from(
      { length: 450 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    dir = [
      { id: A, name: "Пригласивший", archived: false, settings: { served_by: "v2" } },
      ...ids.map((id, i) => ({
        id,
        name: `Секретное имя ${i}`,
        archived: false,
        settings: {
          invite: {
            by: A,
            at: "",
            ...(i === 0 ? { reward: { at: "x", by: "o", payment_id: null } } : {}),
          },
        },
      })),
      { id: B, name: "Чужой", archived: false, settings: { invite: { by: B, at: "" } } },
    ];
    db.tables.subscription_payments = [
      { id: "p1", bot_id: ids[0], amount: 9900, note: null },
      { id: "p2", bot_id: ids[400], amount: 9900, note: null },
      { id: "p3", bot_id: ids[1], amount: 0, note: null },
      { id: "p4", bot_id: ids[2], amount: 500, note: "Зачёт за приглашение «Х» (платёж p1)" },
      { id: "p5", bot_id: B, amount: 9900, note: null },
    ];
    const ctx = { tenant: { id: A }, appUrl: "https://app.test/" } as never;
    const card = await inviteCard(ctx);
    expect(card.link.startsWith("https://app.test/signup?invite=")).toBe(true);
    expect(card.link).toContain(A);
    expect(card).toMatchObject({ registered: 450, paid: 2, credited: 1 });
    expect(JSON.stringify(card)).not.toContain("Секретное имя");
    // Платёж магазина вне списка (чужой приглашённый) в счёт не идёт.
    expect((await paidShops([ids[0]!, ids[400]!])).size).toBe(2);
  });

  it("сбой чтения платежей — ошибка, а не «оплатили 0»", async () => {
    const orig = db.from.bind(db);
    db.from = (t: string) => {
      if (t !== "subscription_payments") return orig(t);
      const q: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, k) =>
            k === "then"
              ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } })
              : () => q,
        },
      );
      return q as never;
    };
    await expect(paidShops([A])).rejects.toThrow(/платежи не прочитаны/);
  });
});
