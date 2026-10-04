import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { CHAT_SLOT } from "./channel.server";
import { moveStudentCohort } from "./move.server";
import { parseRun, runKey } from "./run.server";

/** Перевод ученика в другой поток: запись прохождения, чат, событие, гонка. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [],
  cohorts: [
    {
      id: C1,
      title: "Октябрь",
      start: "2026-10-05T10:00",
      enrollUntil: "2026-10-04",
      chat: "-1007770001",
    },
    {
      id: C2,
      title: "Ноябрь",
      start: "2026-11-05T10:00",
      enrollUntil: "2026-11-04",
      chat: "-1008880001",
    },
  ],
};
const NOW = new Date("2026-10-10T10:00:00Z");

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: null, name_snapshot: "К" },
  ];
  db.tables.orders = [
    {
      id: 7,
      status: "delivered",
      platform: "telegram",
      telegram_id: 555,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  db.tables.zernio_logs = [];
  db.tables.app_settings = [
    {
      bot_id: T,
      key: courseKey(P),
      value: JSON.stringify({
        ...course,
        lessons: [{ id: "l1", title: "Урок", text: "", files: [], link: null }],
      }),
    },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({
        startedAt: "2026-10-01T00:00:00Z",
        done: ["l1"],
        cohortId: C1,
        pre: [3],
      }),
    },
    {
      bot_id: T,
      key: CHAT_SLOT.key("item-1"),
      value: JSON.stringify({ member: 555, link: "https://t.me/+x" }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true } },
    db,
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, db };
}
const row = (db: ReturnType<typeof setup>["db"], key: string) =>
  (db.tables.app_settings as Array<Record<string, string>>).find((r) => r.key === key);

describe("перевод в другой поток", () => {
  it("меняет поток, исключает из старого чата, сбрасывает метку чата, пишет событие", async () => {
    const { ctx, db } = setup();
    const kicks: Array<[string, number]> = [];
    const access = {
      createInvite: async () => null,
      kick: async (c: string, u: number) => (kicks.push([c, u]), true),
      revokeInvite: async () => {},
    };
    const r = await moveStudentCohort(ctx, "item-1", C2, access, "admin", NOW);
    expect(r).toMatchObject({ ok: true, from: C1, to: C2, kicked: 1, failed: 0 });
    expect(kicks).toEqual([["-1007770001", 555]]);
    const run = parseRun(row(db, runKey("item-1"))!.value)!;
    expect(run.cohortId).toBe(C2);
    expect(run.done).toEqual(["l1"]);
    expect(run.pre).toBeUndefined();
    expect(JSON.parse(row(db, CHAT_SLOT.key("item-1"))?.value ?? "null")).toEqual({});
    const ev = (db.tables.zernio_logs as Array<Record<string, unknown>>).map((e) => e.event_type);
    expect(ev).toEqual(["order.cohort_moved"]);
  });

  it("тот же поток и чужой поток не принимаются; гонка — проигравший не пишет", async () => {
    const { ctx, db } = setup();
    expect(await moveStudentCohort(ctx, "item-1", C1, null, "admin", NOW)).toEqual({
      ok: false,
      reason: "same",
    });
    expect(
      await moveStudentCohort(
        ctx,
        "item-1",
        "d3000000-0000-4000-8000-000000000003",
        null,
        "admin",
        NOW,
      ),
    ).toEqual({ ok: false, reason: "noCohort" });
    expect((db.tables.zernio_logs as unknown[]).length).toBe(0);
    // первый перевод выигрывает; второй из «старого» состояния уже не проходит
    expect((await moveStudentCohort(ctx, "item-1", C2, null, "admin", NOW)).ok).toBe(true);
    expect(await moveStudentCohort(ctx, "item-1", C2, null, "admin", NOW)).toEqual({
      ok: false,
      reason: "same",
    });
  });

  it("Telegram не исключил — событие красным, поток всё равно сменён", async () => {
    const { ctx, db } = setup();
    const access = { createInvite: async () => null, kick: async () => false };
    const r = await moveStudentCohort(ctx, "item-1", C2, access, "admin", NOW);
    expect(r).toMatchObject({ ok: true, kicked: 0, failed: 1 });
    expect(parseRun(row(db, runKey("item-1"))!.value)!.cohortId).toBe(C2);
  });

  it("ученик в чат не вступал — это не сбой; без бота при ссылке — сбой, но участник и ссылка помнятся честно", async () => {
    const a = setup();
    (a.db.tables.orders as Array<Record<string, unknown>>)[0]!.platform = "instagram";
    (a.db.tables.orders as Array<Record<string, unknown>>)[0]!.telegram_id = -555;
    const slot = row(a.db, CHAT_SLOT.key("item-1"))!;
    slot.value = JSON.stringify({});
    const kick = { createInvite: async () => null, kick: async () => true };
    expect(await moveStudentCohort(a.ctx, "item-1", C2, kick, "admin", NOW)).toMatchObject({
      ok: true,
      kicked: 0,
      failed: 0,
    });

    const b = setup();
    expect(await moveStudentCohort(b.ctx, "item-1", C2, null, "admin", NOW)).toMatchObject({
      ok: true,
      failed: 1,
    });
    // исключить не удалось — вступивший остаётся в записи, старая ссылка не тянется в новый чат
    expect(JSON.parse(row(b.db, CHAT_SLOT.key("item-1"))?.value ?? "null")).toEqual({
      member: 555,
    });
  });
});
