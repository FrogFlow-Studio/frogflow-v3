import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { enqueueOutbox, processOutbox, type OutboxMessage, type OutboxSender } from "./outbox";

/** Очередь решает по полям отказа отправителя: постоянный отказ и лимит запросов. */
const now = new Date("2026-09-27T10:00:00Z");
const msg = (text: string): OutboxMessage => ({
  kind: "customer_notice",
  target: { channel: "telegram", chatId: "1" },
  text,
  audience: "customer",
});

function setup() {
  const db = fakeDb();
  db.tables.zernio_logs = [];
  const ctx = { tenant: { id: "shop" }, db } as unknown as TenantContext;
  const rows = () => db.tables.zernio_logs!;
  const payload = (text: string) =>
    rows().find((r) => (r.payload as { text?: string }).text === text)!;
  return { ctx, rows, payload };
}

describe("очередь исходящих: код отказа", () => {
  it("постоянный отказ канала — сразу «не доставлено», без пяти повторов", async () => {
    const s = setup();
    await enqueueOutbox(s.ctx, msg("a"), { error: "номер недоступен", permanent: true }, now);
    expect(s.payload("a")).toMatchObject({ status: "dead" });

    await enqueueOutbox(s.ctx, msg("b"), null, now);
    const send: OutboxSender = async () => ({ ok: false, error: "нет", permanent: true });
    const r = await processOutbox(s.ctx, send, now);
    expect(r).toMatchObject({ tried: 1, dead: 1 });
    expect(s.payload("b")).toMatchObject({ status: "dead" });
  });

  it("лимит запросов: ждём Retry-After, попытку не тратим, остаток — в следующий прогон", async () => {
    const s = setup();
    await enqueueOutbox(s.ctx, msg("a"), null, now);
    await enqueueOutbox(s.ctx, msg("b"), null, now);
    const sent: string[] = [];
    const send: OutboxSender = async (_c, m) => {
      sent.push(m.text!);
      return { ok: false, error: "429", retryAfterSec: 120 };
    };
    const r = await processOutbox(s.ctx, send, now);
    expect(sent).toEqual(["a"]);
    expect(r).toMatchObject({ tried: 1, requeued: 1, dead: 0 });
    expect(s.payload("a")).toMatchObject({
      status: "queued",
      payload: { attempts: 0, next_at: "2026-09-27T10:02:00.000Z" },
    });
    expect(s.payload("b")).toMatchObject({ status: "queued" });

    // Короткий Retry-After — не чаще раза в минуту (крон и так раз в минуту).
    await enqueueOutbox(s.ctx, msg("c"), { error: "429", retryAfterSec: 3 }, now);
    expect(s.payload("c")).toMatchObject({
      status: "queued",
      payload: { attempts: 0, next_at: "2026-09-27T10:01:00.000Z" },
    });
  });

  it("Retry-After не больше часа и не дальше суток от постановки — потом «не доставлено»", async () => {
    const s = setup();
    await enqueueOutbox(s.ctx, msg("a"), { error: "429", retryAfterSec: 864_000 }, now);
    expect(s.payload("a")).toMatchObject({
      status: "queued",
      payload: { attempts: 0, next_at: "2026-09-27T11:00:00.000Z" },
    });

    await enqueueOutbox(s.ctx, msg("b"), null, now);
    s.payload("b").created_at = "2026-09-26T10:30:00Z";
    const send: OutboxSender = async () => ({ ok: false, error: "429", retryAfterSec: 3600 });
    await processOutbox(s.ctx, send, now);
    expect(s.payload("b")).toMatchObject({ status: "dead", payload: { next_at: null } });
  });

  it("лимит одного получателя (131056) не останавливает очередь магазина", async () => {
    const s = setup();
    const to = (chatId: string, text: string): OutboxMessage => ({
      ...msg(text),
      target: { channel: "telegram", chatId },
    });
    await enqueueOutbox(s.ctx, to("1", "a"), null, now);
    await enqueueOutbox(s.ctx, to("1", "b"), null, now);
    await enqueueOutbox(s.ctx, to("2", "c"), null, now);
    const sent: string[] = [];
    const send: OutboxSender = async (_c, m) => {
      if (m.target.channel === "telegram" && m.target.chatId === "1")
        return { ok: false, error: "131056", retryAfterSec: 60, recipientOnly: true };
      sent.push(m.text!);
      return { ok: true };
    };
    const r = await processOutbox(s.ctx, send, now);
    expect(sent).toEqual(["c"]);
    expect(r).toMatchObject({ tried: 2, sent: 1, requeued: 1 });
    expect(s.payload("b")).toMatchObject({ status: "queued", payload: { attempts: 0 } });
  });

  it("id строки очереди выдаётся до первой отправки и один на все попытки", async () => {
    const s = setup();
    const seen: Array<string | undefined> = [];
    const failing: OutboxSender = async (_c, m) => {
      seen.push(m.eventId);
      return { ok: false, error: "таймаут" };
    };
    const { sendOrEnqueue } = await import("./outbox");
    expect(await sendOrEnqueue(s.ctx, msg("a"), failing)).toBe(false);
    expect(seen[0]).toMatch(/^outbox:/);
    expect(s.payload("a").event_id).toBe(seen[0]);
    s.payload("a").payload = { ...(s.payload("a").payload as object), next_at: now.toISOString() };
    await processOutbox(s.ctx, failing, now);
    expect(seen).toEqual([seen[0], seen[0]]);
  });
});
