import { describe, expect, it } from "vitest";
import type { ApipayConfig, ApipayEvent } from "@/core/billing/pay/apipay";
import { InvoiceAlreadyHandled } from "@/core/billing/invoice-state";
import { settleApipayEvent, type SettleDeps } from "./apipay.server";

const INV = "0b9f6d3e-1c2a-4b5c-8d7e-9f0a1b2c3d4e";
const BOT = "11111111-2222-4333-8444-555555555555";
const live: ApipayConfig = { apiKey: "k", baseUrl: "https://x", live: true, sandboxBotId: null };

function world(inv: { status: string; amount?: number; currency?: string; bot_id?: string }) {
  const row = {
    id: INV,
    bot_id: inv.bot_id ?? BOT,
    amount: inv.amount ?? 9900,
    currency: inv.currency ?? "KZT",
    status: inv.status,
  };
  const logs: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const alerts: string[] = [];
  let confirms = 0;
  let cfg: ApipayConfig | null = live;
  const deps: SettleDeps = {
    config: () => cfg,
    readInvoice: async (id) => (id === INV ? { ...row } : null),
    confirm: async () => {
      confirms++;
      row.status = "paid";
      return { expiresAt: "2026-11-01T00:00:00Z" };
    },
    log: async (_bot, p) => {
      logs.push(p);
    },
    hasPaidEvent: async (_bot, id) =>
      logs.some((l) => l.action === "apipay_paid" && l.apipay_invoice_id === id),
    alert: async (_bot, message) => {
      alerts.push(message);
    },
    notifyOwner: async (_bot, text) => {
      notes.push(text);
    },
  };
  return {
    deps,
    logs,
    notes,
    alerts,
    row,
    confirms: () => confirms,
    setConfig: (c: ApipayConfig | null) => (cfg = c),
  };
}

const paid = (over: Partial<Extract<ApipayEvent, { kind: "paid" }>> = {}): ApipayEvent => ({
  kind: "paid",
  apipayId: "42",
  invoiceId: INV,
  amount: 9900,
  sandbox: false,
  ...over,
});

describe("оплата счёта по вебхуку ApiPay", () => {
  it("оплата открытого счёта подтверждает его и пишет владельцу", async () => {
    const w = world({ status: "sent" });
    expect(await settleApipayEvent(paid(), w.deps)).toEqual({ status: 200, body: "ok" });
    expect(w.confirms()).toBe(1);
    expect(w.logs).toContainEqual(expect.objectContaining({ action: "apipay_paid" }));
    expect(w.notes[0]).toContain("9900 KZT");
  });

  it("счёт с чеком на проверке тоже закрывается оплатой", async () => {
    const w = world({ status: "proof_uploaded" });
    await settleApipayEvent(paid(), w.deps);
    expect(w.confirms()).toBe(1);
  });

  it("повтор вебхука второго платежа не пишет", async () => {
    const w = world({ status: "sent" });
    await settleApipayEvent(paid(), w.deps);
    expect(await settleApipayEvent(paid(), w.deps)).toEqual({
      status: 200,
      body: "already paid",
    });
    expect(w.confirms()).toBe(1);
    expect(w.notes).toHaveLength(1);
  });

  it("вторая оплата уже оплаченного счёта — в журнал и учёт ошибок, не молча", async () => {
    const w = world({ status: "sent" });
    await settleApipayEvent(paid(), w.deps);
    expect((await settleApipayEvent(paid({ apipayId: "43" }), w.deps)).body).toBe(
      "invoice already paid",
    );
    expect(w.confirms()).toBe(1);
    expect(w.logs).toContainEqual(
      expect.objectContaining({ action: "apipay_paid_already_paid", apipay_invoice_id: "43" }),
    );
    expect(w.alerts).toHaveLength(1);
  });

  it("счёт закрыт чеком, а владелец оплатил ещё и ссылкой — тоже тревога", async () => {
    const w = world({ status: "paid" });
    expect((await settleApipayEvent(paid(), w.deps)).body).toBe("invoice already paid");
    expect(w.alerts).toHaveLength(1);
  });

  it("счёт закрыли между чтением и захватом — разбирается как уже оплаченный", async () => {
    const w = world({ status: "sent" });
    w.deps.confirm = async () => {
      w.row.status = "paid";
      throw new InvoiceAlreadyHandled("Счёт уже обработан");
    };
    expect((await settleApipayEvent(paid(), w.deps)).body).toBe("invoice already paid");
    expect(w.alerts).toHaveLength(1);
  });

  it("в боевом режиме оплата без поля is_sandbox не принимается", async () => {
    const w = world({ status: "sent" });
    expect((await settleApipayEvent(paid({ sandbox: null }), w.deps)).body).toBe(
      "sandbox payment ignored",
    );
    expect(w.confirms()).toBe(0);
  });

  it("сумма не совпала — счёт не закрывается, запись в журнал", async () => {
    const w = world({ status: "sent" });
    expect((await settleApipayEvent(paid({ amount: 100 }), w.deps)).body).toBe("amount mismatch");
    expect(w.confirms()).toBe(0);
    expect(w.logs[0]).toMatchObject({ action: "apipay_amount_mismatch", expected: 9900 });
  });

  it("оплата отменённого счёта — оператору, не подтверждается сама", async () => {
    const w = world({ status: "cancelled" });
    expect((await settleApipayEvent(paid(), w.deps)).body).toBe("invoice closed");
    expect(w.confirms()).toBe(0);
    expect(w.logs[0]).toMatchObject({ action: "apipay_paid_closed_invoice", was: "cancelled" });
    expect(w.alerts).toHaveLength(1);
  });

  it("песочная оплата закрывает только счёт тестового магазина в режиме песочницы", async () => {
    const w = world({ status: "sent" });
    // Боевой режим: песочная «оплата» денег не несёт.
    expect((await settleApipayEvent(paid({ sandbox: true }), w.deps)).body).toBe(
      "sandbox payment ignored",
    );
    // Песочница, но счёт другого магазина.
    w.setConfig({ ...live, live: false, sandboxBotId: "другой" });
    expect((await settleApipayEvent(paid({ sandbox: true }), w.deps)).body).toBe(
      "sandbox payment ignored",
    );
    // Без настроек ApiPay — тоже нет.
    w.setConfig(null);
    expect((await settleApipayEvent(paid({ sandbox: true }), w.deps)).body).toBe(
      "sandbox payment ignored",
    );
    expect(w.confirms()).toBe(0);
    w.setConfig({ ...live, live: false, sandboxBotId: BOT });
    expect((await settleApipayEvent(paid({ sandbox: true }), w.deps)).body).toBe("ok");
    expect(w.confirms()).toBe(1);
  });

  it("неизвестный счёт и чужие события — 200 без действий", async () => {
    const w = world({ status: "sent" });
    expect(
      (await settleApipayEvent(paid({ invoiceId: "00000000-0000-4000-8000-000000000000" }), w.deps))
        .body,
    ).toBe("unknown invoice");
    expect(
      (await settleApipayEvent({ kind: "ignored", reason: "status expired" }, w.deps)).status,
    ).toBe(200);
    expect(w.confirms()).toBe(0);
  });

  it("сбой подтверждения — 5xx, даже если счёт остался «оплачен» без платежа", async () => {
    const w = world({ status: "sent" });
    w.deps.confirm = async () => {
      w.row.status = "paid";
      throw new Error("сбой записи платежа");
    };
    await expect(settleApipayEvent(paid(), w.deps)).rejects.toThrow("сбой записи платежа");
    expect(w.notes).toHaveLength(0);
  });

  it("сбой подтверждения — 5xx, чтобы ApiPay повторил", async () => {
    const w = world({ status: "sent" });
    w.deps.confirm = async () => {
      throw new Error("база недоступна");
    };
    await expect(settleApipayEvent(paid(), w.deps)).rejects.toThrow("база недоступна");
    expect(w.notes).toHaveLength(0);
  });
});
