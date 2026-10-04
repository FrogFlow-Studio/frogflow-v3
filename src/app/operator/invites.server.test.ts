import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Зачёт месяца за приглашение автора: деньги и «один раз». База — в памяти
 * (fake-db), платёж и журнал пишутся настоящим кодом billing.server.
 */
let db: FakeDb;
let failInsertPayment = false;
const INVITER = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const INVITEE = "0bac1f86-5231-4e57-838d-2faa44d427e7";
const NOW = new Date("2026-10-04T10:00:00Z");

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: (t: string) => {
      if (t === "subscription_payments" && failInsertPayment) {
        const q: Record<string, unknown> = {
          insert: () => Promise.resolve({ data: null, error: { message: "insert failed" } }),
        };
        const real = db.from(t);
        return new Proxy(real, { get: (r, k) => (k in q ? q[k as string] : (r as never)[k]) });
      }
      return db.from(t);
    },
  }),
}));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  invalidateTenantDirectory: () => {},
  tenantDirectory: async () =>
    db.tables.bots!.map((b) => ({
      id: b.id,
      name: b.name,
      archived: false,
      ownerTelegramId: b.owner_telegram_id ?? null,
      settings: b.settings,
    })),
}));
vi.mock("./health.server", () => ({ latestHealth: async () => new Map() }));
vi.mock("./pulse.server", () => ({ loadPulse: async () => new Map() }));

const { creditInvite, inviteView } = await import("./invites.server");

const bot = (id: string, name: string, settings: Record<string, unknown>, extra = {}) => ({
  id,
  name,
  owner_contact: null,
  owner_telegram_id: null,
  status: "active",
  subscription_expires_at: "2026-10-10",
  settings,
  ...extra,
});
const pay = (id: string, bot_id: string, amount: number, note: string | null = null) => ({
  id,
  bot_id,
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  amount,
  currency: "KZT",
  paid_at: "2026-09-01T00:00:00Z",
  note,
});
const invite = (extra: Record<string, unknown> = {}) => ({
  by: INVITER,
  at: "2026-09-01T00:00:00Z",
  ...extra,
});

beforeEach(() => {
  failInsertPayment = false;
  db = fakeDb({ maxRows: 1000 });
  db.tables.bots = [
    bot(INVITER, "Автор-пригласивший", { served_by: "v2", rev: 1 }),
    bot(INVITEE, "Автор-новичок", { served_by: "v2", rev: 4, invite: invite() }),
  ];
  db.tables.subscription_payments = [pay("pay-1", INVITEE, 24_900)];
  db.tables.bot_events = [];
});

const credits = () =>
  db.tables.subscription_payments!.filter((p) =>
    String(p.note ?? "").startsWith("Зачёт за приглашение"),
  );

describe("зачёт пригласившему", () => {
  it("новичок оплатил: платёж на 0 ₸ продлевает подписку на месяц, номер платежа виден в журнале", async () => {
    const r = await creditInvite(INVITEE, "operator", NOW);
    expect(r).toEqual({ inviterName: "Автор-пригласивший", periodEnd: "2026-11-10" });
    const [c] = credits();
    expect(c).toMatchObject({
      bot_id: INVITER,
      amount: 0,
      period_start: "2026-10-11",
      period_end: "2026-11-10",
    });
    expect(String(c!.note)).toContain("pay-1");
    const ev = db.tables.bot_events!.filter((e) =>
      (e.payload as { action?: string }).action?.startsWith("invite_"),
    );
    expect(ev.map((e) => [e.bot_id, (e.payload as { action: string }).action]).sort()).toEqual([
      [INVITEE, "invite_reward_issued"],
      [INVITER, "invite_credit"],
    ]);
    const stored = db.tables.bots!.find((b) => b.id === INVITEE)!.settings as {
      invite: { reward: unknown };
      rev: number;
    };
    expect(stored.invite.reward).toMatchObject({ payment_id: "pay-1", by: "operator" });
    expect(stored.rev).toBe(5);
  });

  it("двойной клик и два оператора одновременно: платёж один", async () => {
    const results = await Promise.allSettled([
      creditInvite(INVITEE, "op-1", NOW),
      creditInvite(INVITEE, "op-2", NOW),
      creditInvite(INVITEE, "op-1", NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(credits()).toHaveLength(1);
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow(/уже зачтён/);
    expect(credits()).toHaveLength(1);
  });

  it("новичок не платил, или оплату отменили (платёж удалён) — зачёта нет", async () => {
    db.tables.subscription_payments = [];
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow(/не оплатил/);
    db.tables.subscription_payments = [pay("pay-0", INVITEE, 0)];
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow(/не оплатил/);
    expect(credits()).toHaveLength(0);
    expect(
      (db.tables.bots!.find((b) => b.id === INVITEE)!.settings as { invite: { reward?: unknown } })
        .invite.reward,
    ).toBeUndefined();
  });

  it("сам себя: тот же Telegram или телефон владельца — зачёта нет", async () => {
    db.tables.bots![0]!.owner_telegram_id = 777;
    db.tables.bots![1]!.owner_telegram_id = 777;
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow(/сам себя/);
    db.tables.bots![0]!.owner_telegram_id = null;
    db.tables.bots![1]!.owner_telegram_id = null;
    db.tables.bots![0]!.owner_contact = "+7 700 111 22 33";
    db.tables.bots![1]!.owner_contact = "87001112233".replace(/^8/, "+7");
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow(/сам себя/);
    expect(credits()).toHaveLength(0);
  });

  it("платёж не записался — отметка снята, оператор может повторить", async () => {
    failInsertPayment = true;
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow();
    const s = db.tables.bots!.find((b) => b.id === INVITEE)!.settings as {
      invite: { reward?: unknown };
    };
    expect(s.invite.reward).toBeUndefined();
    failInsertPayment = false;
    await creditInvite(INVITEE, "operator", NOW);
    expect(credits()).toHaveLength(1);
  });

  it("зачётный платёж оплатой тарифа не считается: пригласивший не получит зачёт за свои же зачёты", async () => {
    db.tables.subscription_payments = [
      pay("pay-9", INVITEE, 500, "Зачёт за приглашение «Х» (платёж a)"),
    ];
    await expect(creditInvite(INVITEE, "operator", NOW)).rejects.toThrow(/не оплатил/);
  });
});

describe("вид для оператора", () => {
  it("новичок: кто пригласил, оплатил ли, можно ли зачесть; у пригласившего — список приглашённых без пересечений", async () => {
    const a = await inviteView(INVITEE);
    expect(a.invitedBy).toMatchObject({
      id: INVITER,
      name: "Автор-пригласивший",
      paid: true,
      credited: false,
      blocked: null,
    });
    const b = await inviteView(INVITER);
    expect(b.invitedBy).toBeNull();
    expect(b.invited).toEqual([
      { id: INVITEE, name: "Автор-новичок", paid: true, credited: false },
    ]);
    await creditInvite(INVITEE, "operator", NOW);
    expect((await inviteView(INVITEE)).invitedBy).toMatchObject({
      credited: true,
      blocked: "already",
    });
  });
});
