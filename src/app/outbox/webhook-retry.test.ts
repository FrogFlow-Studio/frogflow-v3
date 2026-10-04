import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

type Reply =
  | { ok: true; status: number }
  | { ok: false; error: string; timedOut?: boolean; notSent?: boolean };
let reply: Reply = { ok: true, status: 200 };
const bodies: string[] = [];
vi.mock("@/core/crm/webhook", async (orig) => ({
  ...(await orig<typeof import("@/core/crm/webhook")>()),
  postPinned: vi.fn(async (_u: string, _h: unknown, body: string) => {
    bodies.push(body);
    return reply;
  }),
}));

const { outboxSender } = await import("./senders.server");
const { enqueueOutbox, processOutbox } = await import("@/core/outbox/outbox");
const { retryCrmEvent } = await import("@/core/crm/retry");
const { loadCrmLog } = await import("@/core/crm/log");

const URL = "https://crm.example.kz/hook";
const event = JSON.stringify({ event: "order.placed", event_id: "EV-1", order: { id: 5 } });
const T = new Date("2026-10-04T10:00:00Z");
let ctx: TenantContext;
const rows = () => (ctx.db as unknown as ReturnType<typeof fakeDb>).tables.zernio_logs!;
const run = (min: number) =>
  processOutbox(ctx, outboxSender(), new Date(T.getTime() + min * 60_000));

beforeEach(async () => {
  bodies.length = 0;
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.zernio_logs = [];
  ctx = { db, tenant: { id: "11111111-1111-1111-1111-111111111111" } } as unknown as TenantContext;
  await db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: "crm_webhook",
    value: JSON.stringify({ url: URL, secret: "S", events: [] }),
  });
  await enqueueOutbox(
    ctx,
    {
      kind: "crm_webhook",
      target: { channel: "webhook", url: URL },
      text: event,
      audience: "admin",
    },
    null,
    T,
  );
});

describe("повтор вебхука: только вручную, с тем же event_id", () => {
  it.each([
    ["5xx", { ok: true, status: 503 } as Reply],
    ["таймаут", { ok: false, error: "t", timedOut: true } as Reply],
    ["обрыв после соединения", { ok: false, error: "ECONNRESET" } as Reply],
  ])("%s: сразу «не доставлено», сами не повторяем", async (_n, r) => {
    reply = r;
    await run(0);
    expect(rows()[0]!.status).toBe("dead");
    await run(30);
    await run(300);
    expect(bodies).toHaveLength(1);
  });

  it("соединения не было — безопасно повторить самим; ответ 4xx — тоже", async () => {
    reply = { ok: false, error: "ECONNREFUSED", notSent: true };
    await run(0);
    expect(rows()[0]!.status).toBe("queued");
    reply = { ok: true, status: 404 };
    await run(60);
    expect(rows()[0]!.status).toBe("queued");
    expect(bodies).toHaveLength(2);
  });

  it("ручной повтор из журнала несёт то же тело и event_id; принятое событие повторить нельзя", async () => {
    reply = { ok: true, status: 500 };
    await run(0);
    const outboxId = (await loadCrmLog(ctx))[0]!.outboxId!;
    expect(outboxId).toBe(rows()[0]!.id);

    reply = { ok: true, status: 200 };
    expect(await retryCrmEvent(ctx, outboxId)).toBe("queued");
    await run(1);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[1]!).event_id).toBe("EV-1");
    expect(rows()[0]!.status).toBe("processed");
    expect((await loadCrmLog(ctx)).map((e) => e.outcome)).toEqual(["ok", "http"]);

    expect(await retryCrmEvent(ctx, outboxId)).toBe("not_found");
    await run(5);
    expect(bodies).toHaveLength(2);
  });

  it("чужая или не вебхучная строка очереди не повторяется", async () => {
    await enqueueOutbox(
      ctx,
      {
        kind: "admin_notice",
        target: { channel: "telegram", chatId: "1" },
        text: "x",
        audience: "admin",
      },
      { error: "e", permanent: true },
      T,
    );
    const other = rows().find((r) => r.event_type === "outbox.admin_notice")!;
    expect(other.status).toBe("dead");
    expect(await retryCrmEvent(ctx, other.id as string)).toBe("not_found");
    expect(other.status).toBe("dead");
    expect(await retryCrmEvent(ctx, "00000000-0000-4000-8000-000000000000")).toBe("not_found");
  });
});
