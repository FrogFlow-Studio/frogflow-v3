import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { activeSubscription, hadPaidAccess } from "@/core/vip/vip";
import { cancelBroadcast, hasActiveBroadcast, processBroadcastBatch } from "./broadcasts";

const BOT = "00000000-0000-0000-0000-000000000001";

/** Запросы к `table` отвечают ошибкой базы, остальные идут в подставную базу. */
function breakTable(db: ReturnType<typeof fakeDb>, table: string) {
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
}

function ctxOf(db: unknown) {
  return { tenant: { id: BOT }, db } as unknown as TenantContext;
}

function seed(recipient: Record<string, unknown> = {}) {
  const db = fakeDb();
  db.tables.broadcasts = [
    {
      id: "b1",
      bot_id: BOT,
      status: "sending",
      channel: "telegram",
      message_text: "привет",
      photo_paths: [],
      product_ids: [],
      show_catalog: false,
      total_count: 1,
      sent_count: 0,
      failed_count: 0,
      blocked_count: 0,
      created_at: "2026-09-26T00:00:00Z",
    },
  ];
  db.tables.broadcast_recipients = [
    {
      id: "r0",
      bot_id: BOT,
      broadcast_id: "b1",
      telegram_id: 101,
      phone: null,
      status: "pending",
      sent_at: null,
      error_message: null,
      ...recipient,
    },
  ];
  return db;
}

describe("рассылки: сбой чтения не превращается в «можно слать»", () => {
  it("не прочитали отписавшихся — никому не отправлено, получатель остался в очереди", async () => {
    const db = seed();
    const sent: number[] = [];
    await expect(
      processBroadcastBatch(ctxOf(breakTable(db, "bot_users")), async ({ telegramId }) => {
        sent.push(telegramId);
      }),
    ).rejects.toThrow(/отписавшиеся/);
    expect(sent).toEqual([]);
    expect(db.tables.broadcast_recipients![0]!.status).toBe("pending");
    expect(db.tables.broadcast_recipients![0]!.sent_at).toBeNull();
  });

  it("не прочитали блокировки Telegram — тоже не шлём", async () => {
    const db = seed();
    const sent: number[] = [];
    await expect(
      processBroadcastBatch(ctxOf(breakTable(db, "blocked_users")), async ({ telegramId }) => {
        sent.push(telegramId);
      }),
    ).rejects.toThrow(/блокировки/);
    expect(sent).toEqual([]);
  });

  it("не прочитали список рассылок — крон падает, а не отвечает «рассылок нет»", async () => {
    const db = seed();
    await expect(
      processBroadcastBatch(ctxOf(breakTable(db, "broadcasts")), async () => {}),
    ).rejects.toThrow(/Рассылки/);
    await expect(hasActiveBroadcast(ctxOf(breakTable(db, "broadcasts")))).rejects.toThrow();
  });

  it("не сосчитали остаток — рассылка не закрывается как законченная", async () => {
    const db = seed({ status: "sent", sent_at: "2026-09-26T00:00:00Z" });
    db.tables.broadcast_recipients![0]!.status = "sent";
    const broken = breakTable(db, "broadcast_recipients");
    await expect(processBroadcastBatch(ctxOf(broken), async () => {})).rejects.toThrow();
    expect(db.tables.broadcasts![0]!.status).toBe("sending");
  });

  it("отмена: сбой записи — ошибка, а не «рассылка уже не активна»", async () => {
    const db = seed();
    await expect(cancelBroadcast(ctxOf(breakTable(db, "broadcasts")), "b1")).rejects.toThrow();
    expect(db.tables.broadcasts![0]!.status).toBe("sending");
  });
});

describe("VIP: сбой чтения не равен «подписки нет»", () => {
  it("activeSubscription и hadPaidAccess бросают сбой", async () => {
    const db = fakeDb();
    const ctx = ctxOf(breakTable(db, "vip_subscriptions"));
    await expect(activeSubscription(ctx, 1)).rejects.toThrow(/VIP/);
    await expect(hadPaidAccess(ctx, 1)).rejects.toThrow(/VIP/);
  });
});

describe("рассылки: сбой посреди пакета не теряет уже сделанное", () => {
  it("захват падает на втором получателе — первый отправлен, счётчик записан, затем ошибка", async () => {
    const db = fakeDb({
      rpc: {
        increment_broadcast_counts: (d: FakeDb, a) => {
          const b = d.tables.broadcasts!.find((x) => x.id === a.p_broadcast_id)!;
          b.sent_count = (b.sent_count as number) + (a.p_sent as number);
          b.failed_count = (b.failed_count as number) + (a.p_failed as number);
          b.blocked_count = (b.blocked_count as number) + (a.p_blocked as number);
        },
      },
    });
    Object.assign(db.tables, seed().tables);
    db.tables.broadcast_recipients = [101, 102, 103].map((id, i) => ({
      id: `r${i}`,
      bot_id: BOT,
      broadcast_id: "b1",
      telegram_id: id,
      phone: null,
      status: "pending",
      sent_at: null,
      error_message: null,
    }));
    let claims = 0;
    const flaky = new Proxy(db, {
      get: (t, prop, r) => {
        if (prop !== "from") return Reflect.get(t, prop, r);
        return (name: string) => {
          const q = t.from(name);
          if (name !== "broadcast_recipients") return q;
          return new Proxy(q, {
            get: (qt, qp, qr) => {
              if (qp !== "update") return Reflect.get(qt, qp, qr);
              return (patch: Record<string, unknown>) => {
                const isClaim = Object.keys(patch).join() === "sent_at";
                if (isClaim && ++claims === 2) return breakTable(db, name).from(name);
                return qt.update(patch);
              };
            },
          });
        };
      },
    });
    const sent: number[] = [];
    await expect(
      processBroadcastBatch(ctxOf(flaky), async ({ telegramId }) => {
        sent.push(telegramId);
      }),
    ).rejects.toThrow(/захват/);
    expect(sent).toEqual([101]);
    expect(db.tables.broadcast_recipients![0]!.status).toBe("sent");
    expect(db.tables.broadcasts![0]!.sent_count).toBe(1);
  });
});
