import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { enqueueOutbox, processOutbox } from "@/core/outbox/outbox";
import { zernioOutboxSender } from "./outbox.server";
import { liveTransport } from "./api.server";

/**
 * Д3: отправка через Zernio на обрыве, тайм-ауте и 5xx — настоящий путь:
 * настоящие `request`, `sendInboxMessage`, очередь и классификатор, подставлен
 * только `fetch`. Проверяется то, что видно: сколько запросов ушло, какие,
 * с каким ключом идемпотентности и что записано в строке очереди.
 */
type Call = { method: string; url: string; key: string | null; body: unknown };
let calls: Call[] = [];
let post: Array<() => Response | Promise<Response> | never> = [];
let tail: unknown[] = [];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
  calls = [];
  post = [];
  tail = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        method: init.method ?? "GET",
        url: String(url),
        key: headers["Idempotency-Key"] ?? null,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      if ((init.method ?? "GET") === "GET") return json(200, { messages: tail });
      const next = post.shift();
      if (!next) throw new Error("лишний POST: повтор или второй способ отправки");
      return next();
    }),
  );
});
afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-10-04T10:00:00Z");
const LATER = new Date("2026-10-04T14:00:00Z");
const posts = () => calls.filter((c) => c.method === "POST");

function setup(platform: "instagram" | "whatsapp" = "instagram") {
  const db = fakeDb();
  db.tables.zernio_logs = [];
  db.tables.app_settings = [];
  const ctx = { tenant: { id: "shop" }, db } as unknown as TenantContext;
  const msg = {
    kind: "customer_notice",
    eventId: "outbox:test-1",
    target: {
      channel: "zernio" as const,
      conversationId: "conv-1",
      accountId: "acc-1",
      platform,
      phone: platform === "whatsapp" ? "77001234567" : undefined,
    },
    text: "Заказ отправлен",
    audience: "customer" as const,
  };
  const run = (now = NOW) => processOutbox(ctx, zernioOutboxSender(liveTransport), now);
  return { ctx, msg, run, row: () => db.tables.zernio_logs![0]! };
}

describe("Zernio: что могло дойти — не повторяем и не дублируем другим способом", () => {
  it("500, переписка пуста — сверить нечем: «возможно доставлено», повтора нет", async () => {
    const { ctx, msg, run, row } = setup();
    post = [() => json(500, { error: "boom" })];
    await enqueueOutbox(ctx, msg, null, NOW);
    const r = await run();
    expect(r).toMatchObject({ tried: 1, dead: 1, requeued: 0 });
    expect(row().status).toBe("dead");
    expect(String(row().error_message)).toContain("Возможно доставлено");
    await run(LATER);
    expect(posts()).toHaveLength(1);
  });

  it("500, в переписке нашего сообщения нет — повтор с тем же ключом идемпотентности", async () => {
    const { ctx, msg, run, row } = setup();
    tail = [{ direction: "incoming", message: "Здравствуйте", createdAt: NOW.toISOString() }];
    post = [() => json(500, { error: "boom" })];
    await enqueueOutbox(ctx, msg, null, NOW);
    expect(await run()).toMatchObject({ tried: 1, dead: 0, requeued: 1 });
    expect(row().status).toBe("queued");
    post = [() => json(200, {})];
    await run(LATER);
    expect(posts()).toHaveLength(2);
    expect(posts()[0]!.key).toBeTruthy();
    expect(posts()[1]!.key).toBe(posts()[0]!.key);
    expect(row().status).toBe("processed");
  });

  it("500, а в переписке наше сообщение уже есть — доставлено, второго POST нет", async () => {
    const { ctx, msg, run, row } = setup();
    tail = [
      {
        direction: "outgoing",
        message: "Заказ отправлен",
        createdAt: new Date().toISOString(),
      },
    ];
    post = [() => json(500, { error: "boom" })];
    await enqueueOutbox(ctx, msg, null, NOW);
    const r = await run();
    expect(r).toMatchObject({ sent: 1, dead: 0, requeued: 0 });
    expect(row().status).toBe("processed");
    expect(posts()).toHaveLength(1);
  });

  it.each([
    [
      "тайм-аут",
      () => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
    ],
    ["обрыв соединения", () => Promise.reject(new TypeError("fetch failed"))],
  ])(
    "%s без возможности сверить переписку — «возможно доставлено», повтора нет",
    async (_n, boom) => {
      const { ctx, msg, run, row } = setup();
      // Переписку прочитать нельзя: GET тоже падает.
      (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (_u: string, init: RequestInit = {}) => {
          calls.push({ method: init.method ?? "GET", url: "", key: null, body: null });
          return boom();
        },
      );
      await enqueueOutbox(ctx, msg, null, NOW);
      const r = await run();
      expect(r).toMatchObject({ tried: 1, dead: 1, requeued: 0 });
      expect(row().status).toBe("dead");
      expect(String(row().error_message)).toContain("Возможно доставлено");
      await run(LATER);
      expect(posts()).toHaveLength(1);
    },
  );

  it("503: сообщение точно не ушло — повтор разрешён, ключ идемпотентности тот же", async () => {
    const { ctx, msg, run, row } = setup();
    post = [() => json(503, { error: "unavailable" }, { "retry-after": "30" })];
    await enqueueOutbox(ctx, msg, null, NOW);
    await run();
    expect(row().status).toBe("queued");
    post = [() => json(200, {})];
    await run(LATER);
    expect(posts().map((c) => c.key)).toHaveLength(2);
    expect(posts()[1]!.key).toBe(posts()[0]!.key);
    expect(row().status).toBe("processed");
  });

  it("WhatsApp: 500 не превращается в «первое сообщение по номеру» — второй способ только при закрытом окне", async () => {
    const { ctx, msg, run } = setup("whatsapp");
    post = [() => json(500, { error: "boom" })];
    await enqueueOutbox(ctx, msg, null, NOW);
    await run();
    expect(posts().every((c) => c.url.includes("/inbox/conversations/conv-1/messages"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/inbox/conversations"))).toBe(false);
  });

  it("WhatsApp: окно 24 часа закрыто (131047) — отказ определённый, одно сообщение по номеру тем же ключом очереди", async () => {
    const { ctx, msg, run, row } = setup("whatsapp");
    post = [
      () => json(400, { error: "window", platformError: { code: 131047 } }),
      () => json(200, { conversationId: "c2" }),
    ];
    await enqueueOutbox(ctx, msg, null, NOW);
    await run();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.url.endsWith("/inbox/conversations")).toBe(true);
    expect(row().status).toBe("processed");
  });

  it("постоянный отказ (403): повтора нет, строка «не доставлено»", async () => {
    const { ctx, msg, run, row } = setup();
    post = [() => json(403, { error: "forbidden" })];
    await enqueueOutbox(ctx, msg, null, NOW);
    await run();
    expect(row().status).toBe("dead");
    await run(LATER);
    expect(posts()).toHaveLength(1);
  });

  it("у каждого запроса к Zernio есть тайм-аут", async () => {
    const { ctx, msg, run } = setup();
    const spy = vi.spyOn(AbortSignal, "timeout");
    post = [() => json(200, {})];
    await enqueueOutbox(ctx, msg, null, NOW);
    await run();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
