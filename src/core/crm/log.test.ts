import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { needsManualRetry } = await import("./retry-policy");
const { CRM_LOG_MAX, loadCrmLog, logEntryFor, recordCrmDelivery } = await import("./log");

const ctxWith = () =>
  ({
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
    tenant: { id: "11111111-1111-1111-1111-111111111111" },
  }) as unknown as TenantContext;

const body = (id: number, eventId = "e-" + id) =>
  JSON.stringify({ event: "order.placed", event_id: eventId, order: { id }, secret: "S3CRET" });

describe("журнал доставки вебхуков", () => {
  it("запись: событие, заказ, код и event_id; тела и секрета нет", async () => {
    const ctx = ctxWith();
    const e = logEntryFor(body(7), { ok: true, status: 200 }, {}, new Date("2026-10-04T10:00:00Z"));
    expect(await recordCrmDelivery(ctx, e)).toBe(true);
    const [row] = await loadCrmLog(ctx);
    expect(row).toEqual({
      at: "2026-10-04T10:00:00.000Z",
      event: "order.placed",
      orderId: 7,
      eventId: "e-7",
      outcome: "ok",
      status: 200,
    });
    expect(JSON.stringify(row)).not.toContain("S3CRET");
  });

  it("исходы: 302 — принято, 500 — отказ с кодом, таймаут, обрыв", () => {
    expect(logEntryFor(body(1), { ok: true, status: 302 }).outcome).toBe("ok");
    const h = logEntryFor(body(1), { ok: true, status: 500 });
    expect([h.outcome, h.status]).toEqual(["http", 500]);
    expect(logEntryFor(body(1), { ok: false, error: "x", timedOut: true }).outcome).toBe("timeout");
    const n = logEntryFor(body(1), { ok: false, error: "ECONNRESET" });
    expect([n.outcome, n.status]).toEqual(["network", null]);
  });

  it("«соединения не было» (ENOTFOUND) — отдельный исход: очередь повторит сама, кнопки «Повторить» нет", () => {
    const e = logEntryFor(body(1), { ok: false, error: "getaddrinfo ENOTFOUND", notSent: true });
    expect([e.outcome, e.status]).toEqual(["notSent", null]);
    expect(needsManualRetry(e)).toBe(false);
    expect(needsManualRetry(logEntryFor(body(1), { ok: false, error: "ECONNRESET" }))).toBe(true);
    expect(needsManualRetry(logEntryFor(body(1), { ok: false, error: "x", timedOut: true }))).toBe(
      true,
    );
    expect(needsManualRetry(logEntryFor(body(1), { ok: true, status: 503 }))).toBe(true);
    expect(needsManualRetry(logEntryFor(body(1), { ok: true, status: 404 }))).toBe(false);
  });

  it("кольцо: держит последние 100, свежие сверху", async () => {
    const ctx = ctxWith();
    for (let i = 1; i <= CRM_LOG_MAX + 5; i++)
      await recordCrmDelivery(ctx, logEntryFor(body(i), { ok: true, status: 200 }));
    const log = await loadCrmLog(ctx);
    expect(log).toHaveLength(CRM_LOG_MAX);
    expect(log[0]!.orderId).toBe(CRM_LOG_MAX + 5);
    expect(log.at(-1)!.orderId).toBe(6);
  });

  it("гонка: 20 событий одновременно — ни одно не потеряно", async () => {
    const ctx = ctxWith();
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordCrmDelivery(ctx, logEntryFor(body(i + 1), { ok: true, status: 200 })),
      ),
    );
    expect(res.every(Boolean)).toBe(true);
    const log = await loadCrmLog(ctx);
    expect(new Set(log.map((x) => x.orderId)).size).toBe(20);
  });

  it("битый журнал не роняет отправку: читается как пустой", async () => {
    const ctx = ctxWith();
    await ctx.db
      .from("app_settings")
      .insert({ bot_id: ctx.tenant.id, key: "crm_webhook_log", value: "{oops" });
    expect(await loadCrmLog(ctx)).toEqual([]);
    expect(await recordCrmDelivery(ctx, logEntryFor(body(1), { ok: true, status: 200 }))).toBe(
      true,
    );
    expect(await loadCrmLog(ctx)).toHaveLength(1);
  });
});
