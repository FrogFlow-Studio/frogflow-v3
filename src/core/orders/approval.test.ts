import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordOrderEvent } from "./events";
import { approvalState, isApprovalYes, recordApprovalAnswer } from "./approval";

const BOT = "00000000-0000-0000-0000-0000000000a9";
let db: FakeDb;
let ctx: TenantContext;
let clock = 0;

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = [];
  ctx = { db, tenant: { id: BOT, modules: {} } } as unknown as TenantContext;
});

/** created_at ставит Postgres; база в памяти — нет, порядок событий задаём сами. */
async function event(kind: Parameters<typeof recordOrderEvent>[2], payload = {}) {
  await recordOrderEvent(ctx, 7, kind, payload, "admin");
  db.tables.zernio_logs!.at(-1)!.created_at = new Date(
    Date.UTC(2026, 8, 28, 10, 0, clock++),
  ).toISOString();
}

describe("согласование фото", () => {
  it("состояние: ждёт после отправки, ответ закрывает, новое фото снова ждёт", () => {
    const e = (kind: string, payload: Record<string, unknown> = {}) =>
      ({ kind, at: "t", payload }) as Parameters<typeof approvalState>[0][number];
    expect(approvalState([])).toEqual({ status: "none" });
    expect(approvalState([e("approval_sent", { key: "a" })]).status).toBe("waiting");
    expect(
      approvalState([e("approval_sent", { key: "a" }), e("approval_changes", { text: "крем" })]),
    ).toMatchObject({ status: "changes", key: "a", text: "крем" });
    expect(
      approvalState([
        e("approval_sent", { key: "a" }),
        e("approval_ok"),
        e("approval_sent", { key: "b" }),
      ]),
    ).toMatchObject({ status: "waiting", key: "b" });
  });

  it("ответ пишется один раз и только на отправленное фото", async () => {
    expect(await recordApprovalAnswer(ctx, 7, { ok: true })).toBe(false);
    await event("approval_sent", { key: "k1" });
    expect(await recordApprovalAnswer(ctx, 7, { ok: false, text: " больше ягод " })).toBe(true);
    expect(await recordApprovalAnswer(ctx, 7, { ok: true })).toBe(false);
    const kinds = db.tables.zernio_logs!.map((r) => r.event_type);
    expect(kinds).toEqual(["order.approval_sent", "order.approval_changes"]);
    expect(db.tables.zernio_logs!.at(-1)!.payload).toMatchObject({
      key: "k1",
      text: "больше ягод",
    });
  });

  it("согласие словом в Instagram/WhatsApp; вопрос или правка — не согласие", () => {
    for (const t of ["да", "Нравится!", "ок", "👍", "иә", "всё нравится)"])
      expect(isApprovalYes(t), t).toBe(true);
    for (const t of ["да, но крем другой", "можно ярче?", "нет"])
      expect(isApprovalYes(t), t).toBe(false);
  });
});
