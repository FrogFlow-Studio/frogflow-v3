import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { CHAT_SLOT, inviteKey } from "./channel.server";
import { extendStudentAccess } from "./extend.server";
import { courseTimeline } from "./cohort";
import { parseRun, runKey } from "./run.server";

/** Продление доступа вручную: срок в записи прохождения, причина, закрытый по сроку доступ. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V = "bbbbbbbb-0000-4000-8000-000000000001";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [{ id: "l1", title: "Урок", text: "", files: [], link: null }],
  tariffs: { [V]: { homework: true, channel: true, accessDays: 30 } },
};
const STARTED = "2026-10-01T00:00:00Z";
const NOW = new Date("2026-10-20T10:00:00Z"); // доступ до 31.10

function setup(variant: string | null = V, run: object = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: variant, name_snapshot: "К" },
  ];
  db.tables.orders = [
    { id: 7, status: "delivered", platform: "telegram", telegram_id: 555, created_at: STARTED },
  ];
  db.tables.zernio_logs = [];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(course) },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({ startedAt: STARTED, done: [], ...run }),
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

describe("продление доступа", () => {
  it("продлевает до конца дня, пишет причину в историю заказа, срок виден в календаре", async () => {
    const { ctx, db } = setup();
    const r = await extendStudentAccess(ctx, "item-1", "2026-11-15", " болел ", "admin", NOW);
    expect(r).toEqual({ ok: true, until: "2026-11-15T20:59:59.999Z" });
    const run = parseRun(row(db, runKey("item-1"))!.value)!;
    const tl = courseTimeline(
      { course, run, boughtAt: STARTED, variantId: V },
      ctx.timezone,
      new Date("2026-11-10T00:00:00Z"),
    );
    expect(tl.expired).toBe(false);
    expect(tl.expiresAt).toBe("2026-11-15T20:59:59.999Z");
    const ev = db.tables.zernio_logs as Array<{ event_type: string; payload: { reason: string } }>;
    expect(ev.map((e) => e.event_type)).toEqual(["order.access_extended"]);
    expect(ev[0]!.payload.reason).toBe("болел");
  });

  it("отказы: нет причины, дата не позже срока, бессрочный тариф, плохая дата", async () => {
    const { ctx, db } = setup();
    expect(await extendStudentAccess(ctx, "item-1", "2026-11-15", "  ", "admin", NOW)).toEqual({
      ok: false,
      reason: "noReason",
    });
    expect(await extendStudentAccess(ctx, "item-1", "2026-10-30", "ещё", "admin", NOW)).toEqual({
      ok: false,
      reason: "notLater",
    });
    expect(await extendStudentAccess(ctx, "item-1", "31.10", "ещё", "admin", NOW)).toEqual({
      ok: false,
      reason: "badDay",
    });
    expect((db.tables.zernio_logs as unknown[]).length).toBe(0);
    expect(parseRun(row(db, runKey("item-1"))!.value)!.until).toBeUndefined();
    const free = setup(null);
    expect(
      await extendStudentAccess(free.ctx, "item-1", "2026-11-15", "ещё", "admin", NOW),
    ).toEqual({ ok: false, reason: "unlimited" });
  });

  it("повторное продление короче уже выданного не проходит", async () => {
    const { ctx } = setup();
    expect((await extendStudentAccess(ctx, "item-1", "2026-11-15", "а", "admin", NOW)).ok).toBe(
      true,
    );
    expect(await extendStudentAccess(ctx, "item-1", "2026-11-10", "б", "admin", NOW)).toEqual({
      ok: false,
      reason: "notLater",
    });
  });

  it("доступ уже закрыт кроном: отметка закрытия и «снято» сбрасываются", async () => {
    const later = new Date("2026-11-05T10:00:00Z");
    const { ctx, db } = setup(V, { accessEnded: "2026-11-01T00:00:00Z" });
    (db.tables.app_settings as Array<Record<string, string>>).push(
      {
        bot_id: T,
        key: inviteKey("item-1"),
        value: JSON.stringify({ member: 555, revoked: "2026-11-01T00:00:00Z" }),
      },
      {
        bot_id: T,
        key: CHAT_SLOT.key("item-1"),
        value: JSON.stringify({ revoked: "2026-11-01T00:00:00Z" }),
      },
    );
    expect(
      (await extendStudentAccess(ctx, "item-1", "2026-11-30", "рассрочка", "admin", later)).ok,
    ).toBe(true);
    expect(parseRun(row(db, runKey("item-1"))!.value)!.accessEnded).toBeUndefined();
    expect(JSON.parse(row(db, inviteKey("item-1"))?.value ?? "null")).toEqual({});
    expect(JSON.parse(row(db, CHAT_SLOT.key("item-1"))?.value ?? "null")).toEqual({});
  });
});
