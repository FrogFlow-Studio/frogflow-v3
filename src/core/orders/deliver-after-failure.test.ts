import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { deliverOrder } from "./orders";

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

function setup() {
  const db = fakeDb();
  db.tables.orders = [
    {
      id: 9,
      bot_id: BOT,
      status: "paid",
      platform: "telegram",
      telegram_id: 1,
      total: 500,
      currency: "KZT",
      fulfillment_kind: "digital",
      points_earned: 0,
    },
  ];
  db.tables.order_items = [
    {
      id: "it-1",
      order_id: 9,
      product_id: null,
      name_snapshot: "Методичка",
      material_files_by_lang: {
        ru: [{ path: null, name: null, url: "https://example.com/m.pdf" }],
      },
      delivered_language: null,
    },
  ];
  db.tables.referrals = [];
  db.tables.zernio_logs = [];
  return db;
}

describe("выдача: сбой начисления или награды не рвёт уже сделанную выдачу", () => {
  for (const table of ["bot_users", "referrals"]) {
    it(`сбой чтения ${table} после выдачи — заказ всё равно «выдан», материалы ушли`, async () => {
      const db = setup();
      const ctx = {
        tenant: { id: BOT, modules: { loyalty: true, referral: true }, settings: {} },
        db: breakTable(db, table),
      } as unknown as TenantContext;
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const sent: string[] = [];
      const r = await deliverOrder(ctx, 9, async (item) => {
        sent.push(String(item.name_snapshot));
        return "sent";
      });
      expect(r).toMatchObject({ ok: true, failed: 0 });
      expect(sent).toEqual(["Методичка"]);
      expect(db.tables.orders![0]!.status).toBe("delivered");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("[orders]"));
      log.mockRestore();
    });
  }
});

describe("выдача: сбой записи хода не оставляет заказ в «delivering»", () => {
  it("после второй позиции ход не записался — третья не отправлена, заказ ждёт подтверждения, событие записано", async () => {
    const db = setup();
    db.tables.order_items = ["Первая", "Вторая", "Третья"].map((name, i) => ({
      id: `it-${i + 1}`,
      order_id: 9,
      product_id: null,
      name_snapshot: name,
      material_files_by_lang: {
        ru: [{ path: null, name: null, url: `https://example.com/${i}.pdf` }],
      },
      delivered_language: null,
    }));
    const flaky = new Proxy(db, {
      get: (t, prop, r) => {
        if (prop !== "from") return Reflect.get(t, prop, r);
        return (name: string) => {
          const q = t.from(name);
          if (name !== "orders") return q;
          return new Proxy(q, {
            get: (qt, qp, qr) =>
              qp === "update"
                ? (patch: Record<string, unknown>) =>
                    patch.delivery_index === 2
                      ? breakTable(db, "orders").from("orders")
                      : qt.update(patch)
                : Reflect.get(qt, qp, qr),
          });
        };
      },
    });
    const ctx = {
      tenant: { id: BOT, modules: {}, settings: {} },
      db: flaky,
    } as unknown as TenantContext;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: string[] = [];
    await expect(
      deliverOrder(ctx, 9, async (item) => {
        sent.push(String(item.name_snapshot));
        return "sent";
      }),
    ).rejects.toThrow(/ход выдачи/);
    log.mockRestore();
    // Ход пишется после отправки позиции: вторая ушла, третья — нет.
    expect(sent).toEqual(["Первая", "Вторая"]);
    expect(db.tables.orders![0]).toMatchObject({
      status: "awaiting_confirmation",
      admin_note: "Выдача прервана: сбой базы",
    });
    expect(
      (db.tables.zernio_logs ?? []).some((e) => e.event_type === "order.delivery_failed"),
    ).toBe(true);
  });
});
