import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { enqueueOutbox, processOutbox } from "@/core/outbox/outbox";
import type { TgResult } from "./api";

/**
 * Д3: исходящее в Telegram из очереди. Обрыв, тайм-аут и 5xx — Telegram мог
 * принять сообщение: очередь его не повторяет (дубль продавцу или покупателю
 * хуже тишины), строка остаётся в «не доставлено» с честной пометкой.
 */
const calls: unknown[] = [];
let answer: TgResult = { ok: true };
vi.mock("./notify", () => ({
  adminTelegramApi: () => ({
    call: async (_m: string, payload: unknown) => {
      calls.push(payload);
      return answer;
    },
  }),
}));

const { telegramOutboxSender } = await import("./outbox");

const NOW = new Date("2026-10-04T10:00:00Z");
const LATER = new Date("2026-10-04T14:00:00Z");

function setup() {
  const db = fakeDb();
  db.tables.zernio_logs = [];
  const ctx = { tenant: { id: "shop" }, db } as unknown as TenantContext;
  return { ctx, row: () => db.tables.zernio_logs![0]! };
}
const msg = {
  kind: "customer_notice",
  target: { channel: "telegram" as const, chatId: "77" },
  text: "Заказ отправлен",
  audience: "customer" as const,
};

beforeEach(() => {
  calls.length = 0;
  answer = { ok: true };
});

describe("очередь Telegram: что могло дойти — не повторяем", () => {
  it.each([
    ["обрыв сети", { ok: false, description: "network error" }],
    ["тайм-аут", { ok: false, description: "timeout" }],
    ["5xx без кода ответа", { ok: false, description: "Bad Gateway" }],
  ])("%s: одна отправка, строка «не доставлено», второй прогон ничего не шлёт", async (_n, r) => {
    const { ctx, row } = setup();
    await enqueueOutbox(ctx, msg, null, NOW);
    answer = r;
    const first = await processOutbox(ctx, telegramOutboxSender, NOW);
    expect(first).toMatchObject({ tried: 1, dead: 1, requeued: 0 });
    expect(row().status).toBe("dead");
    expect(String(row().error_message)).toContain("Возможно доставлено");
    // Через четыре часа (последняя пауза повторов) очередь пуста: повтора нет.
    const again = await processOutbox(ctx, telegramOutboxSender, LATER);
    expect(again.tried).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("ответ Telegram 400 (не принял точно): повтор идёт по обычным правилам очереди", async () => {
    const { ctx, row } = setup();
    await enqueueOutbox(ctx, msg, null, NOW);
    answer = { ok: false, description: "Too Many Requests: retry later", error_code: 429 };
    const r = await processOutbox(ctx, telegramOutboxSender, NOW);
    expect(r).toMatchObject({ tried: 1, requeued: 1, dead: 0 });
    expect(row().status).toBe("queued");
  });

  it("покупатель заблокировал бота — «не доставлено» сразу, без повторов", async () => {
    const { ctx, row } = setup();
    await enqueueOutbox(ctx, msg, null, NOW);
    answer = { ok: false, description: "Forbidden: bot was blocked by the user", error_code: 403 };
    await processOutbox(ctx, telegramOutboxSender, NOW);
    expect(row().status).toBe("dead");
    expect(String(row().error_message)).not.toContain("Возможно доставлено");
  });

  it("успех — строка обработана", async () => {
    const { ctx, row } = setup();
    await enqueueOutbox(ctx, msg, null, NOW);
    await processOutbox(ctx, telegramOutboxSender, NOW);
    expect(row().status).toBe("processed");
  });
});
