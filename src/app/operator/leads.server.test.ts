import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

// Воронка лидов: добавление без дублей, условная смена стадии (v1 двигает те же строки), журнал.
const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const srv = await import("./leads.server");
const { cleanLeadInput } = await import("@/core/leads/leads");

const NOW = new Date("2026-10-03T10:00:00Z");
const input = (o: Record<string, unknown> = {}) =>
  cleanLeadInput({ businessName: "Кофейня Север", instagramHandle: "@sever", ...o })!;

beforeEach(() => {
  db.tables.sales_leads = [];
  db.tables.sales_lead_events = [];
});

describe("addLead", () => {
  it("сохраняет лид вручную на стадии «Новый» и пишет событие", async () => {
    const r = await srv.addLead(input({ phone: "+7 705 111 22 33" }), "admin_a");
    expect(r.ok).toBe(true);
    expect(db.tables.sales_leads!).toHaveLength(1);
    expect(db.tables.sales_leads![0]).toMatchObject({
      business_name: "Кофейня Север",
      instagram_handle: "sever",
      phone: "77051112233",
      source: "manual",
      stage: "new",
      created_by: "admin_a",
    });
    expect(db.tables.sales_lead_events).toMatchObject([{ kind: "created", actor: "admin_a" }]);
  });

  it("тот же Instagram или телефон — не второй лид", async () => {
    await srv.addLead(input({ phone: "77051112233" }), "a");
    expect(await srv.addLead(input({ businessName: "Другое имя" }), "a")).toEqual({
      ok: false,
      duplicate: "Кофейня Север",
    });
    expect(
      await srv.addLead(
        input({ businessName: "Ещё", instagramHandle: "other", phone: "8 (705) 111-22-33" }),
        "a",
      ),
    ).toMatchObject({ ok: true }); // 8… — другая запись телефона, это уже решает человек
    expect(db.tables.sales_leads!).toHaveLength(2);
  });

  it("ошибка чтения списка — serverFailure, а не «дублей нет»", async () => {
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      const q = real(t);
      return t === "sales_leads"
        ? Object.assign(q, {
            select: () => ({
              order: () => ({
                order: () => ({ range: async () => ({ data: null, error: { message: "boom" } }) }),
              }),
            }),
          })
        : q;
    }) as typeof db.from;
    await expect(srv.addLead(input(), "a")).rejects.toMatchObject({ name: "ServerFailure" });
    db.from = real;
    expect(db.tables.sales_leads!).toHaveLength(0);
  });
});

describe("setLeadStage — условная запись", () => {
  const seed = (stage = "new") => {
    db.tables.sales_leads = [
      { id: "l1", business_name: "A", stage, contacted_at: null, replied_at: null },
    ];
  };

  it("меняет стадию, ставит метку «написали» один раз и пишет событие", async () => {
    seed();
    expect(await srv.setLeadStage({ id: "l1", from: "new", to: "contacted" }, "a", NOW)).toEqual({
      ok: true,
    });
    expect(db.tables.sales_leads![0]).toMatchObject({
      stage: "contacted",
      contacted_at: NOW.toISOString(),
    });
    expect(db.tables.sales_lead_events).toMatchObject([
      { lead_id: "l1", kind: "stage", detail: "Новый → Написали" },
    ]);
    await srv.setLeadStage({ id: "l1", from: "contacted", to: "new" }, "a", NOW);
    await srv.setLeadStage(
      { id: "l1", from: "new", to: "contacted" },
      "a",
      new Date("2026-10-04T10:00:00Z"),
    );
    expect(db.tables.sales_leads![0]!.contacted_at).toBe(NOW.toISOString());
  });

  it("гонка: стадию уже сдвинул v1 — вторая запись ничего не меняет и не оставляет события", async () => {
    seed("replied"); // оператор видел «new», конвейер v1 успел перевести в «replied»
    expect(await srv.setLeadStage({ id: "l1", from: "new", to: "lost" }, "a", NOW)).toEqual({
      ok: false,
      reason: "changed",
    });
    expect(db.tables.sales_leads![0]!.stage).toBe("replied");
    expect(db.tables.sales_lead_events).toHaveLength(0);
  });

  it("два оператора с одной стадии: выигрывает один, событие одно", async () => {
    seed();
    const [x, y] = await Promise.all([
      srv.setLeadStage({ id: "l1", from: "new", to: "qualified" }, "a", NOW),
      srv.setLeadStage({ id: "l1", from: "new", to: "rejected" }, "b", NOW),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(db.tables.sales_lead_events).toHaveLength(1);
  });

  it("«Потерян» хранит причину; нет такого лида — not_found", async () => {
    seed();
    await srv.setLeadStage({ id: "l1", from: "new", to: "lost", lostReason: " дорого " }, "a", NOW);
    expect(db.tables.sales_leads![0]).toMatchObject({ stage: "lost", lost_reason: "дорого" });
    expect(await srv.setLeadStage({ id: "zzz", from: "new", to: "hot" }, "a", NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("заметки и журнал", () => {
  it("заметка пишет только свои поля: стадия и оценка v1 целы", async () => {
    db.tables.sales_leads = [{ id: "l1", stage: "hot", score: 80, notes: null }];
    expect(
      await srv.saveLeadNote(
        {
          id: "l1",
          notes: " созвон ",
          nextAction: "Позвонить",
          nextActionAt: "2026-10-05T09:00:00Z",
        },
        NOW,
      ),
    ).toBe(true);
    expect(db.tables.sales_leads![0]).toMatchObject({
      stage: "hot",
      score: 80,
      notes: "созвон",
      next_action: "Позвонить",
    });
    expect(
      await srv.saveLeadNote({ id: "nope", notes: null, nextAction: null, nextActionAt: null }),
    ).toBe(false);
  });

  it("журнал лида — только его события, свежие сверху", async () => {
    db.tables.sales_lead_events = [
      { id: "e1", lead_id: "l1", created_at: "2026-10-01T00:00:00Z", kind: "created" },
      { id: "e2", lead_id: "l2", created_at: "2026-10-02T00:00:00Z", kind: "created" },
      { id: "e3", lead_id: "l1", created_at: "2026-10-03T00:00:00Z", kind: "stage" },
    ];
    expect((await srv.listLeadEvents("l1")).map((e) => e.id)).toEqual(["e3", "e1"]);
  });
});
