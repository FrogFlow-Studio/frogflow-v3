import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { CONTACTS_MIN_ROLE, roleAllows } from "@/core/auth/roles";
import { customerPanel } from "./panel";

const BOT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function setup(helpdesk = true) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.bot_users = [
    {
      bot_id: BOT,
      telegram_id: 7,
      user_key: "tg:7",
      loyalty_points: 120,
      contact_phone: "+77001234567",
      email: "buyer@example.com",
    },
    // Тот же telegram_id в чужом магазине — панель его не видит.
    { bot_id: OTHER, telegram_id: 8, user_key: "tg:8", loyalty_points: 999 },
  ];
  const order = (
    id: number,
    status: string,
    total: number,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    bot_id: BOT,
    telegram_id: 7,
    order_no: id,
    display_no: null,
    status,
    total,
    currency: "KZT",
    created_at: `2026-09-${String(id).padStart(2, "0")}T10:00:00Z`,
    ...over,
  });
  db.tables.orders = [
    // 8 заказов: оплачены и выполнены — покупки, отменённый и неоплаченный — нет.
    ...Array.from({ length: 6 }, (_, i) => order(i + 1, "delivered", 1000)),
    order(7, "cancelled", 5000),
    order(8, "awaiting_payment", 7000),
    // Чужой заказ чужого магазина с тем же telegram_id и заказ другого покупателя.
    order(9, "delivered", 100_000, { bot_id: OTHER }),
    order(10, "delivered", 50_000, { telegram_id: 99 }),
  ];
  const ticket = (id: string, n: number, status: string, tg: number, bot = BOT) => ({
    id,
    bot_id: bot,
    event_id: `ticket:${bot}:${n}`,
    event_type: "ticket",
    status,
    payload: { telegram_id: tg, number: n, subject: `Тема ${n}` },
    created_at: `2026-09-2${n}T10:00:00Z`,
  });
  db.tables.zernio_logs = [
    ticket("a", 1, "open", 7),
    ticket("b", 2, "closed", 7),
    ticket("c", 3, "pending", 7),
    ticket("d", 4, "open", 99),
    ticket("e", 5, "open", 7, OTHER),
  ];
  const ctx = {
    tenant: { id: BOT, modules: { helpdesk } },
    db,
  } as unknown as TenantContext;
  return { ctx };
}

describe("панель покупателя в диалоге", () => {
  it("последние 5 заказов, сумма покупок по всем, баллы, открытые обращения", async () => {
    const p = (await customerPanel(setup().ctx, 7))!;
    expect(p.userKey).toBe("tg:7");
    expect(p.points).toBe(120);
    expect(p.orders.map((o) => o.no)).toEqual([8, 7, 6, 5, 4]);
    expect(p.orders[0]).toMatchObject({ status: "awaiting_payment", total: 7000, currency: "KZT" });
    // Покупки — по всем заказам, а не по пяти показанным: 6 × 1000, отменённый и неоплаченный не в счёт.
    expect(p.stats.count).toBe(6);
    expect(p.stats.totals).toEqual({ KZT: 6000 });
    expect(p.tickets).toEqual([
      { number: 3, subject: "Тема 3", status: "waiting" },
      { number: 1, subject: "Тема 1", status: "open" },
    ]);
  });

  it("чужой магазин и чужой покупатель — ничего: нет профиля, нет заказов и обращений", async () => {
    const { ctx } = setup();
    expect(await customerPanel(ctx, 8)).toBeNull();
    expect(await customerPanel(ctx, 12345)).toBeNull();
    const p = (await customerPanel(ctx, 7))!;
    expect(p.orders.every((o) => o.id !== 9 && o.id !== 10)).toBe(true);
    expect(p.tickets.map((t) => t.number)).not.toContain(4);
    expect(p.tickets.map((t) => t.number)).not.toContain(5);
  });

  it("контактов в панели нет; модуль обращений выключен — обращений нет", async () => {
    const p = (await customerPanel(setup(false).ctx, 7))!;
    expect(JSON.stringify(p)).not.toMatch(/77001234567|buyer@example/);
    expect(p.tickets).toEqual([]);
  });

  it("карточка (в ней контакты) — только роли с доступом к контактам", () => {
    expect(CONTACTS_MIN_ROLE).toBe("manager");
    expect(roleAllows("owner", CONTACTS_MIN_ROLE)).toBe(true);
    expect(roleAllows("manager", CONTACTS_MIN_ROLE)).toBe(true);
    expect(roleAllows("viewer", CONTACTS_MIN_ROLE)).toBe(false);
    expect(roleAllows("accountant", CONTACTS_MIN_ROLE)).toBe(false);
  });
});
