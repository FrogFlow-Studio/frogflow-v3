import { describe, expect, it } from "vitest";
import { defaultNotifyPrefs } from "./prefs";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { digestDue, markDigested, queuedDigestItems, renderDigest } from "./digest";

describe("дайджест продавцу", () => {
  it("шлётся в свой час по поясу и не дважды в день", () => {
    const p = { ...defaultNotifyPrefs(), digest: { enabled: true, hour: 9 } };
    const nineAlmaty = new Date("2026-09-26T04:15:00Z");
    expect(digestDue(p, nineAlmaty, "Asia/Almaty", null, "2026-09-26")).toBe(true);
    expect(digestDue(p, nineAlmaty, "Asia/Almaty", "2026-09-26", "2026-09-26")).toBe(false);
    expect(digestDue(p, new Date("2026-09-26T06:15:00Z"), "Asia/Almaty", null, "2026-09-26")).toBe(
      false,
    );
    expect(digestDue(defaultNotifyPrefs(), nineAlmaty, "Asia/Almaty", null, "2026-09-26")).toBe(
      false,
    );
  });
  it("сводка: заказы, ожидание, недоставленное и отложенные строки", () => {
    const text = renderDigest(
      "25.09",
      {
        ordersYesterday: 3,
        revenueYesterday: { total: 15000, currency: "KZT" },
        awaitingConfirmation: 2,
        undelivered: 1,
      },
      [{ id: "1", kind: "question", text: "🙋 Клиент ждёт менеджера\nподробности", at: "" }],
    );
    expect(text).toContain("Заказов: 3 на 15000 KZT");
    expect(text).toContain("Ждут подтверждения: 2");
    expect(text).toContain("Не доставлено сообщений: 1");
    expect(text).toContain("• 🙋 Клиент ждёт менеджера");
    expect(text).not.toContain("подробности");
  });
});

const ctxWith = (db: unknown) => ({ tenant: { id: "bot" }, db }) as unknown as TenantContext;

function queued(n: number, createdAt = "2026-10-03T20:00:00Z") {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(4, "0")}`,
    bot_id: "bot",
    event_id: `digest:${i}`,
    event_type: "digest.question",
    status: "queued",
    payload: { text: `пункт ${i}` },
    created_at: createdAt,
  }));
}

describe("отложенные пункты дайджеста", () => {
  it("читает все, а не первые 100, даже с одинаковым временем", async () => {
    const db = fakeDb();
    db.tables.zernio_logs = queued(2300);
    const items = await queuedDigestItems(ctxWith(db));
    expect(items).toHaveLength(2300);
    expect(new Set(items.map((i) => i.id)).size).toBe(2300);
  });

  it("ошибка чтения — исключение, а не пустой список", async () => {
    const chain: Record<string, unknown> = {};
    const q = new Proxy(chain, {
      get: (_t, k) =>
        k === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => q,
    });
    await expect(queuedDigestItems(ctxWith({ from: () => q }))).rejects.toThrow();
  });

  it("отмечает пачками по 200 и только стоящие в очереди; повтор безвреден", async () => {
    const db = fakeDb({ maxIn: 200 });
    db.tables.zernio_logs = queued(450);
    db.tables.zernio_logs!.push({
      ...queued(1)[0]!,
      id: "other",
      event_id: "digest:x",
      status: "processed",
    });
    const ids = db.tables.zernio_logs!.slice(0, 450).map((r) => r.id as string);
    expect(await markDigested(ctxWith(db), ids)).toBe(0);
    expect(await markDigested(ctxWith(db), ids)).toBe(0);
    expect(db.tables.zernio_logs!.filter((r) => r.status === "queued")).toHaveLength(0);
  });

  it("сбой записи отметки возвращается числом, а не бросается", async () => {
    const q: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "down" } })
            : () => q,
      },
    );
    expect(await markDigested(ctxWith({ from: () => q }), ["a"])).toBe(1);
  });
});
