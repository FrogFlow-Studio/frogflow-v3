import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  parsePhpForm,
  parseVipChargeRef,
  prodamusConfig,
  vipChargeRef,
} from "@/core/payments/prodamus";
import { applyVipProdamusPayment, vipProdamusLink } from "./prodamus-payment";
import type { VipGroup } from "./vip";

/**
 * Оплата VIP картой РФ через Продамус: ссылка несёт заявку и сумму под
 * подписью, успешное уведомление открывает подписку (та же активация, что
 * у чека), повтор уведомления ничего не делает, чужая сумма — продавцу.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const SUB = "5ab10000-0000-4000-8000-000000000001";

const kz = prodamusConfig(
  {
    prodamus_enabled: "true",
    prodamus_form_url: "kopilka-rusoveda.proeducation.kz",
    prodamus_secret_key: "secret",
  },
  true,
);
if (!kz.ready) throw new Error("not ready");
const cfg = kz;

function setup(status = "pending_payment") {
  const db = fakeDb({ unique: { zernio_logs: [["bot_id", "event_id"]] } });
  db.tables.app_settings = [
    { bot_id: BOT, key: "vip_group_id", value: "-100500" },
    { bot_id: BOT, key: "admin_chat_id", value: "42" },
  ];
  db.tables.zernio_logs = [];
  db.tables.vip_subscriptions = [
    {
      id: SUB,
      bot_id: BOT,
      telegram_id: 777,
      first_name: "Анна",
      last_name: null,
      username: null,
      status,
      created_at: "2026-10-12T06:00:00Z",
      expires_at: new Date().toISOString(),
      group_invite_link: null,
      tariff_id: "t-1",
      vip_tariffs: { id: "t-1", name: "Месяц", price: 5000, currency: "KZT", duration_days: 30 },
    },
  ];
  const group = {
    member: vi.fn(async () => null),
    createInvite: vi.fn(async () => "https://t.me/+invite"),
    revokeInvite: vi.fn(async () => {}),
    kick: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async (_id: number, _html: string) => true),
  } satisfies VipGroup;
  const ctx = {
    tenant: { id: BOT, plan: null, settings: {}, modules: {}, ownerTelegramId: null },
    timezone: "Asia/Almaty",
    appUrl: "https://app.example",
    db,
  } as unknown as TenantContext;
  return { db, ctx, group };
}

const success = (ref: string, sum = "5000.00") => ({
  order_num: ref,
  order_id: "511700",
  sum,
  currency: "rub",
  payment_status: "success",
});

describe("VIP через Продамус", () => {
  it("ссылка: форма продавца, сумма тарифа, order_id — заявка под подписью", async () => {
    const { ctx } = setup();
    const link = await vipProdamusLink(ctx, cfg, {
      subscriptionId: SUB,
      tariff: { name: "Месяц", price: 5000, currency: "KZT" },
      back: "https://t.me/kkp_vip_bot",
    });
    expect(link).toMatchObject({ amount: 5000, currency: "KZT" });
    const url = new URL(link!.url);
    expect(url.origin).toBe("https://kopilka-rusoveda.proeducation.kz");
    const q = parsePhpForm(url.search.slice(1));
    expect(q).toMatchObject({
      urlNotification: `https://app.example/api/prodamus/${BOT}`,
      products: [{ name: "VIP: Месяц", price: "5000.00" }],
    });
    expect(parseVipChargeRef(cfg, q.order_id)).toEqual({
      subscriptionId: SUB,
      amount: 5000,
      currency: "KZT",
    });
  });

  it("подделанная сумма в ссылке не принимается", () => {
    const ref = vipChargeRef(cfg, SUB, { amount: 5000, currency: "KZT" });
    expect(parseVipChargeRef(cfg, ref.replace("-500000-", "-100-"))).toBeNull();
    expect(parseVipChargeRef(cfg, "511632")).toBeNull();
  });

  it("оплата открывает подписку: участнику ссылка в группу, продавцу сумма и номер платежа", async () => {
    const { db, ctx, group } = setup();
    const ref = parseVipChargeRef(cfg, vipChargeRef(cfg, SUB, { amount: 5000, currency: "KZT" }))!;
    const n = success(vipChargeRef(cfg, SUB, ref));
    expect(await applyVipProdamusPayment(ctx, cfg, group, ref, n)).toBe("vip_paid");
    expect(db.tables.vip_subscriptions![0]).toMatchObject({
      status: "active",
      group_invite_link: "https://t.me/+invite",
    });
    const toBuyer = group.send.mock.calls.find((c) => c[0] === 777);
    expect(toBuyer?.[1]).toContain("https://t.me/+invite");
    const toSeller = group.send.mock.calls.find((c) => c[0] === 42);
    expect(toSeller?.[1]).toContain("5000.00 KZT");
    expect(toSeller?.[1]).toContain("511700");
    expect(toSeller?.[1]).toContain("картой RUB");
    expect(db.tables.zernio_logs).toHaveLength(1);
  });

  it("повтор уведомления ничего не шлёт второй раз", async () => {
    const { ctx, group } = setup();
    const raw = vipChargeRef(cfg, SUB, { amount: 5000, currency: "KZT" });
    const ref = parseVipChargeRef(cfg, raw)!;
    await applyVipProdamusPayment(ctx, cfg, group, ref, success(raw));
    const sent = group.send.mock.calls.length;
    expect(await applyVipProdamusPayment(ctx, cfg, group, ref, success(raw))).toBe(
      "vip_already_done",
    );
    expect(group.send.mock.calls.length).toBe(sent);
  });

  it("сумма не по тарифу заявки — подписка не открывается, продавцу сообщение", async () => {
    const { db, ctx, group } = setup();
    const raw = vipChargeRef(cfg, SUB, { amount: 1500, currency: "KZT" });
    const ref = parseVipChargeRef(cfg, raw)!;
    expect(await applyVipProdamusPayment(ctx, cfg, group, ref, success(raw, "1500.00"))).toBe(
      "vip_sum_mismatch",
    );
    expect(db.tables.vip_subscriptions![0]!.status).toBe("pending_payment");
    expect(group.send.mock.calls.map((c) => c[0])).toEqual([42]);
  });

  it("оплата по отклонённой заявке — деньги видны продавцу, подписка не открывается", async () => {
    const { db, ctx, group } = setup("cancelled");
    const raw = vipChargeRef(cfg, SUB, { amount: 5000, currency: "KZT" });
    const ref = parseVipChargeRef(cfg, raw)!;
    expect(await applyVipProdamusPayment(ctx, cfg, group, ref, success(raw))).toBe(
      "vip_not_pending",
    );
    expect(db.tables.vip_subscriptions![0]!.status).toBe("cancelled");
    expect(group.send.mock.calls[0]?.[1]).toContain("5000.00 KZT");
  });
});
